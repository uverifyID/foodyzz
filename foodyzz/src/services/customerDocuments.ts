// Customer identity documents — driver license (front + back) and proof of address.
//
// Images live in Cloud Storage, never in the Firestore user document: a base64
// image would blow past the 1MB doc limit and ride along on every profile listener.
// Only the storage PATHS are written to users/{phone}; readers resolve a short-lived
// download URL through the Storage rules (owner, or Foodyzz staff via the admin claim).
//
// Every image is resized and re-compressed below MAX_UPLOAD_BYTES before it leaves the
// device. Resizing first (rather than only dropping JPEG quality) is what keeps a
// licence number legible at a small file size.
import storage from '@react-native-firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { db, auth } from './firebase';
import type { CustomerDocument } from '../types';

export type DocKind = 'driverLicense' | 'addressProof';
export type DocSide = 'front' | 'back';

/** Hard ceiling for an uploaded document image. */
export const MAX_UPLOAD_BYTES = 500 * 1024;

// Longest edge to try, in order. A licence is legible well below the full sensor
// resolution, so we start at a sane document size rather than shrinking a 12MP photo.
const WIDTH_STEPS = [1600, 1280, 1024, 800];
const QUALITY_STEPS = [0.7, 0.55, 0.4];

const pathFor = (phone: string, kind: DocKind, side: DocSide) =>
  `${kind === 'driverLicense' ? 'driverLicenses' : 'addressProofs'}/${phone}/${side}.jpg`;

const byteSize = async (uri: string): Promise<number> => {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    // If the size can't be read, assume it needs compressing rather than skipping it.
    return Number.MAX_SAFE_INTEGER;
  }
};

/**
 * Resize + compress until the image is under MAX_UPLOAD_BYTES. Walks width down
 * first (preserves legibility better than quality alone), then quality within each
 * width. Returns the smallest result produced even if the ceiling can't be met, so
 * an upload never hard-fails on an unusual image.
 */
export const compressForUpload = async (localUri: string): Promise<string> => {
  let best = localUri;
  let bestSize = await byteSize(localUri);
  if (bestSize <= MAX_UPLOAD_BYTES) return localUri;

  for (const width of WIDTH_STEPS) {
    for (const compress of QUALITY_STEPS) {
      const out = await ImageManipulator.manipulateAsync(
        localUri,
        [{ resize: { width } }],
        { compress, format: ImageManipulator.SaveFormat.JPEG },
      );
      const size = await byteSize(out.uri);
      if (size < bestSize) { best = out.uri; bestSize = size; }
      if (size <= MAX_UPLOAD_BYTES) return out.uri;
    }
  }
  console.warn(`compressForUpload: floor of ${Math.round(bestSize / 1024)}KB exceeds the 500KB target`);
  return best;
};

/**
 * Prompt for a document photo. `source` picks the camera or the photo library —
 * both are offered because a customer often already has a scan on their phone.
 * Returns the local file uri, or null if they cancelled / denied permission.
 */
export const pickDocumentImage = async (
  source: 'camera' | 'library',
  kind: DocKind = 'driverLicense',
): Promise<string | null> => {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    // A licence is a 1.586:1 card, so a fixed crop keeps both sides consistent for
    // the reviewer. Proof of address is a document page — leave it uncropped.
    ...(kind === 'driverLicense' ? { aspect: [16, 10] as [number, number] } : {}),
    quality: 0.9,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
};

/**
 * Compress, then upload, returning the storage path. Overwrites any previous image
 * for that side so a re-scan replaces rather than accumulates.
 */
export const uploadDocumentImage = async (
  kind: DocKind,
  side: DocSide,
  localUri: string,
): Promise<string> => {
  const phone = auth().currentUser?.phoneNumber;
  if (!phone) throw new Error('You must be signed in to upload a document.');
  const ready = await compressForUpload(localUri);
  const path = pathFor(phone, kind, side);
  await storage().ref(path).putFile(ready, { contentType: 'image/jpeg' });
  return path;
};

/**
 * Record a document on the user profile. Written as a fresh submission —
 * `reviewedAt` is cleared so a re-scan goes back into the review queue rather than
 * inheriting the previous approval.
 */
export const saveDocumentToProfile = async (
  kind: DocKind,
  frontPath: string,
  backPath?: string,
): Promise<void> => {
  const phone = auth().currentUser?.phoneNumber;
  if (!phone) throw new Error('You must be signed in.');
  const doc: CustomerDocument = {
    frontPath,
    ...(backPath ? { backPath } : {}),
    uploadedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectedReason: null,
  };
  await db.collection('users').doc(phone).set({ [kind]: doc }, { merge: true });
};

/** Resolve a storage path to a temporary https URL for display. */
export const documentImageUrl = async (path: string): Promise<string> =>
  storage().ref(path).getDownloadURL();

/** A licence is on file once both sides are uploaded; address proof needs one page. */
export const hasDocumentOnFile = (profile: any, kind: DocKind): boolean =>
  kind === 'driverLicense'
    ? !!profile?.driverLicense?.frontPath && !!profile?.driverLicense?.backPath
    : !!profile?.addressProof?.frontPath;

/** Both documents present AND verified — what lets a bike go out for delivery. */
export const areDocumentsVerified = (profile: any): boolean =>
  hasDocumentOnFile(profile, 'driverLicense') &&
  hasDocumentOnFile(profile, 'addressProof') &&
  !!profile?.driverLicense?.reviewedAt &&
  !!profile?.addressProof?.reviewedAt;

// ── Back-compat aliases (the older licence-only call sites) ──────────────────
export const pickLicenseImage = (source: 'camera' | 'library') => pickDocumentImage(source, 'driverLicense');
export const uploadLicenseSide = (side: DocSide, uri: string) => uploadDocumentImage('driverLicense', side, uri);
export const saveLicenseToProfile = (front: string, back: string) => saveDocumentToProfile('driverLicense', front, back);
export const licenseImageUrl = documentImageUrl;
export const hasLicenseOnFile = (profile: any) => hasDocumentOnFile(profile, 'driverLicense');
export const isLicenseReviewed = (profile: any) =>
  hasDocumentOnFile(profile, 'driverLicense') && !!profile?.driverLicense?.reviewedAt;
export type LicenseSide = DocSide;
