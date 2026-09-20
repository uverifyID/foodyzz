// Customer identity documents — driver license (front + back), proof of address, and
// a selfie (checked against the licence photo, and the picture on the worker ID).
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

export type DocKind = 'driverLicense' | 'addressProof' | 'selfie';
export type DocSide = 'front' | 'back';

// Storage folder per document kind. Each has its own match block in storage.rules.
const FOLDER: Record<DocKind, string> = {
  driverLicense: 'driverLicenses',
  addressProof: 'addressProofs',
  selfie: 'selfies',
};

/** Hard ceiling for an uploaded document image. */
export const MAX_UPLOAD_BYTES = 500 * 1024;

// Longest edge to try, in order. A licence is legible well below the full sensor
// resolution, so we start at a sane document size rather than shrinking a 12MP photo.
const WIDTH_STEPS = [1600, 1280, 1024, 800];
const QUALITY_STEPS = [0.7, 0.55, 0.4];

// Every upload gets its own file name rather than overwriting `${side}.jpg`. With
// a fixed name, an upload that succeeded next to one that failed replaced an
// APPROVED image while the profile still said it was reviewed, and a re-submit
// left readers holding the old path's download URL.
const pathFor = (phone: string, kind: DocKind, side: DocSide) =>
  `${FOLDER[kind]}/${phone}/${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

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
    // the reviewer. A selfie is a square head-and-shoulders shot on the front camera.
    // Proof of address is a document page — leave it uncropped.
    ...(kind === 'driverLicense' ? { aspect: [16, 10] as [number, number] } : {}),
    ...(kind === 'selfie' ? { aspect: [1, 1] as [number, number], cameraType: ImagePicker.CameraType.front } : {}),
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
 * Compress, then upload to a new file, returning its storage path. The image it
 * replaces is removed with deleteDocumentImages once the profile points at the
 * new one.
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

/**
 * Record the whole identity set — licence, proof of address and selfie — in ONE
 * write. The server's "documents uploaded" alert fires on users/{phone} writes, so
 * saving them one at a time would alert FoodyzzHQ before the last one landed.
 * Every submission resets all three to unreviewed: the set is verified together.
 */
export const saveIdentitySetToProfile = async (paths: {
  licenseFront: string;
  licenseBack: string;
  address: string;
  selfie: string;
}): Promise<void> => {
  const phone = auth().currentUser?.phoneNumber;
  if (!phone) throw new Error('You must be signed in.');
  const fresh = (frontPath: string, backPath?: string): CustomerDocument => ({
    frontPath,
    ...(backPath ? { backPath } : {}),
    uploadedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectedReason: null,
  });
  await db.collection('users').doc(phone).set(
    {
      driverLicense: fresh(paths.licenseFront, paths.licenseBack),
      addressProof: fresh(paths.address),
      selfie: fresh(paths.selfie),
    },
    { merge: true },
  );
};

/**
 * Record any subset of the documents in ONE write, each as a fresh unreviewed
 * submission. Used by the verification screen, where the licence + selfie and the
 * proof of address are submitted separately (see services/verification).
 */
export const saveDocumentsToProfile = async (
  docs: Partial<Record<DocKind, { frontPath: string; backPath?: string }>>,
): Promise<void> => {
  const phone = auth().currentUser?.phoneNumber;
  if (!phone) throw new Error('You must be signed in.');
  const uploadedAt = new Date().toISOString();
  const update: Record<string, CustomerDocument> = {};
  for (const [kind, d] of Object.entries(docs)) {
    if (!d) continue;
    update[kind] = {
      frontPath: d.frontPath,
      ...(d.backPath ? { backPath: d.backPath } : {}),
      uploadedAt,
      reviewedAt: null,
      reviewedBy: null,
      rejectedReason: null,
    };
  }
  await db.collection('users').doc(phone).set(update, { merge: true });
};

/**
 * Best-effort removal of document images that nothing points at any more — the
 * ones a submission replaced, or the uploads of a submission that failed. Never
 * throws: a leftover file costs a few hundred KB, a thrown error here would turn a
 * successful submission into a failed one.
 */
export const deleteDocumentImages = (paths: (string | null | undefined)[]): void => {
  paths.filter((p): p is string => !!p).forEach((p) => {
    storage().ref(p).delete().catch((e) => console.warn(`deleteDocumentImages: ${p}`, e?.code || e));
  });
};

/** Resolve a storage path to a temporary https URL for display. */
export const documentImageUrl = async (path: string): Promise<string> =>
  storage().ref(path).getDownloadURL();

/** A licence is on file once both sides are uploaded; address proof and selfie need one image. */
export const hasDocumentOnFile = (profile: any, kind: DocKind): boolean =>
  kind === 'driverLicense'
    ? !!profile?.driverLicense?.frontPath && !!profile?.driverLicense?.backPath
    : !!profile?.[kind]?.frontPath;

/** All three present AND verified — what lets a bike go out for delivery. */
export const areDocumentsVerified = (profile: any): boolean =>
  hasDocumentOnFile(profile, 'driverLicense') &&
  hasDocumentOnFile(profile, 'addressProof') &&
  hasDocumentOnFile(profile, 'selfie') &&
  !!profile?.driverLicense?.reviewedAt &&
  !!profile?.addressProof?.reviewedAt &&
  !!profile?.selfie?.reviewedAt;

// ── Back-compat aliases (the older licence-only call sites) ──────────────────
export const pickLicenseImage = (source: 'camera' | 'library') => pickDocumentImage(source, 'driverLicense');
export const uploadLicenseSide = (side: DocSide, uri: string) => uploadDocumentImage('driverLicense', side, uri);
export const saveLicenseToProfile = (front: string, back: string) => saveDocumentToProfile('driverLicense', front, back);
export const licenseImageUrl = documentImageUrl;
export const hasLicenseOnFile = (profile: any) => hasDocumentOnFile(profile, 'driverLicense');
export const isLicenseReviewed = (profile: any) =>
  hasDocumentOnFile(profile, 'driverLicense') && !!profile?.driverLicense?.reviewedAt;
export type LicenseSide = DocSide;
