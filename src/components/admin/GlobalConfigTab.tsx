import React from 'react';
import { Settings, CreditCard, Save, AlertTriangle, Bike, DollarSign, Clock, Package } from 'lucide-react';
import { GlobalConfig, LogisticsConfig } from '../../types';

interface GlobalConfigTabProps {
    editConfig: GlobalConfig;
    // apiConfig/logistics — null until the seed script has run at least once.
    editLogistics: LogisticsConfig | null;
    handleChange: (field: string, value: string | number | boolean) => void;
    handleNumericChange: (field: string, value: string) => void;
    handleLogisticsChange: (field: string, value: any) => void;
    handleSave: () => Promise<void>;
    saving: boolean;
    error: string | null;
}

const input = "w-full p-3 border-2 border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-green";
const label = "block text-sm font-bold text-gray-700 mb-1";
const card = "space-y-4 p-6 border-2 border-black rounded-lg shadow-brutalist-green bg-gray-50";

export default function GlobalConfigTab({
    editConfig, editLogistics, handleChange, handleNumericChange, handleLogisticsChange, handleSave, saving, error,
}: GlobalConfigTabProps) {
    const models = editLogistics?.bikeModels ?? [];
    const fees = editLogistics?.fees ?? [];
    const inventory = editLogistics?.inventory ?? {};

    // Array fields are written back whole — the dotted-path setter can address an
    // index ('bikeModels.0.rates.rent'), but replacing the array keeps the edit
    // atomic and avoids a partially-updated model row.
    const updateModel = (idx: number, path: string, value: any) => {
        const next = models.map((m, i) => {
            if (i !== idx) return m;
            const copy: any = { ...m, rates: { ...m.rates }, minCommitment: { ...m.minCommitment } };
            const parts = path.split('.');
            let cur = copy;
            for (let p = 0; p < parts.length - 1; p++) cur = cur[parts[p]];
            cur[parts[parts.length - 1]] = value;
            return copy;
        });
        handleLogisticsChange('bikeModels', next);
    };

    const updateFee = (idx: number, key: string, value: any) => {
        handleLogisticsChange('fees', fees.map((f, i) => (i === idx ? { ...f, [key]: value } : f)));
    };

    const updateInventory = (model: string, condition: 'new' | 'used', value: number) => {
        handleLogisticsChange('inventory', {
            ...inventory,
            [model]: { ...(inventory[model] || { new: 0, used: 0 }), [condition]: value },
        });
    };

    return (
        <div className="flex flex-col">
            <header className="mb-8">
                <h2 className="text-3xl font-black uppercase tracking-tighter">Global Configuration</h2>
                <p className="text-stone-500 text-sm font-bold uppercase font-mono">Bike rates, fees, inventory &amp; platform settings</p>
            </header>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Error!</strong>
                    <span className="block sm:inline"> {error}</span>
                </div>
            )}

            {!editLogistics && (
                <div className="bg-amber-50 border-2 border-amber-300 text-amber-800 px-4 py-3 rounded mb-8 font-mono text-xs">
                    <strong className="font-black uppercase">apiConfig/logistics is empty.</strong>{' '}
                    Run <code className="bg-white px-1 border border-amber-300">npm --prefix functions run seed:logistics</code> to
                    create it from the project appendix, then reload.
                </div>
            )}

            {/* ── Bike rate model ─────────────────────────────────────────────── */}
            {editLogistics && (
                <div className={`${card} mb-8`}>
                    <h2 className="text-xl font-black uppercase text-black flex items-center gap-2 mb-1">
                        <Bike size={24} className="text-brand-green-dark" /> Bike Models &amp; Rates
                    </h2>
                    <p className="text-xs text-stone-500 font-mono mb-3">
                        Rent is billed per week, Rent&nbsp;to&nbsp;Buy per month, Buy is a one-time price.
                        Minimum commitment is the shortest term a customer may choose.
                    </p>

                    {models.map((m, idx) => (
                        <div key={m.model} className="border-2 border-black rounded-lg bg-white p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black uppercase text-sm">Model {m.model}</h3>
                                <span className="text-[10px] font-mono text-stone-400 uppercase">
                                    {(inventory[String(m.model)]?.new ?? 0) + (inventory[String(m.model)]?.used ?? 0)} in inventory
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={label}>Display Name</label>
                                    <input type="text" value={m.name} onChange={(e) => updateModel(idx, 'name', e.target.value)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Image URL</label>
                                    <input
                                        type="text"
                                        value={m.imageUrl}
                                        placeholder="https://… (shown on the model card in Foodyzz)"
                                        onChange={(e) => updateModel(idx, 'imageUrl', e.target.value)}
                                        className={input}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className={label}>Rent ($ / week)</label>
                                    <input type="number" step="0.01" value={m.rates.rent}
                                        onChange={(e) => updateModel(idx, 'rates.rent', parseFloat(e.target.value) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Rent to Buy ($ / month)</label>
                                    <input type="number" step="0.01" value={m.rates.rentToBuy}
                                        onChange={(e) => updateModel(idx, 'rates.rentToBuy', parseFloat(e.target.value) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Buy ($ one time)</label>
                                    <input type="number" step="0.01" value={m.rates.buy}
                                        onChange={(e) => updateModel(idx, 'rates.buy', parseFloat(e.target.value) || 0)} className={input} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className={label}>Min Rent (weeks)</label>
                                    <input type="number" step="1" value={m.minCommitment.rent}
                                        onChange={(e) => updateModel(idx, 'minCommitment.rent', parseInt(e.target.value, 10) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Min Rent to Buy (months)</label>
                                    <input type="number" step="1" value={m.minCommitment.rentToBuy}
                                        onChange={(e) => updateModel(idx, 'minCommitment.rentToBuy', parseInt(e.target.value, 10) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>New in stock</label>
                                    <input type="number" step="1" value={inventory[String(m.model)]?.new ?? 0}
                                        onChange={(e) => updateInventory(String(m.model), 'new', parseInt(e.target.value, 10) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Used in stock</label>
                                    <input type="number" step="1" value={inventory[String(m.model)]?.used ?? 0}
                                        onChange={(e) => updateInventory(String(m.model), 'used', parseInt(e.target.value, 10) || 0)} className={input} />
                                </div>
                            </div>
                            <p className="text-[11px] text-stone-400 font-mono">
                                Stock counts here are the restock baseline. Live availability comes from the
                                individual bike records on the Bikes tab.
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Fees ────────────────────────────────────────────────────────── */}
            {editLogistics && (
                <div className={`${card} mb-8`}>
                    <h2 className="text-xl font-black uppercase text-black flex items-center gap-2 mb-1">
                        <DollarSign size={24} className="text-brand-green-dark" /> Rental Fees
                    </h2>
                    <p className="text-xs text-stone-500 font-mono mb-3">
                        Shown to the customer on every Rent and Rent&nbsp;to&nbsp;Buy order (never on a Buy).
                        Required fees cannot be opted out of. The deposit is disclosed but never billed on the
                        rental invoice — it is secured separately against the customer's card at delivery.
                    </p>
                    <div className="space-y-3">
                        {fees.map((f, idx) => (
                            <div key={f.key} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border-2 border-black rounded-lg bg-white p-3">
                                <div>
                                    <label className={label}>Fee</label>
                                    <input type="text" value={f.label} onChange={(e) => updateFee(idx, 'label', e.target.value)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Amount ($)</label>
                                    <input type="number" step="0.01" value={f.amount}
                                        onChange={(e) => updateFee(idx, 'amount', parseFloat(e.target.value) || 0)} className={input} />
                                </div>
                                <div>
                                    <label className={label}>Cadence</label>
                                    <select value={f.cadence} onChange={(e) => updateFee(idx, 'cadence', e.target.value)} className={input}>
                                        <option value="once">One time</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </div>
                                <label className="flex items-center gap-2 p-3 font-bold text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={f.required}
                                        // The deposit is structurally mandatory — it secures the bike itself,
                                        // so it must not become opt-out via a stray click.
                                        disabled={!!f.isDeposit}
                                        onChange={(e) => updateFee(idx, 'required', e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                    Required{f.isDeposit ? ' (deposit)' : ''}
                                </label>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Delivery window + restock ───────────────────────────────────── */}
            {editLogistics && (
                <div className={`${card} mb-8`}>
                    <h2 className="text-xl font-black uppercase text-black flex items-center gap-2 mb-1">
                        <Clock size={24} className="text-brand-green-dark" /> Delivery Window
                    </h2>
                    <p className="text-xs text-stone-500 font-mono mb-3">
                        The band customers pick a delivery slot from, sliced into equal windows.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className={label}>Start Time</label>
                            <input type="time" value={editLogistics.delivery?.startTime ?? '17:00'}
                                onChange={(e) => handleLogisticsChange('delivery.startTime', e.target.value)} className={input} />
                        </div>
                        <div>
                            <label className={label}>End Time</label>
                            <input type="time" value={editLogistics.delivery?.endTime ?? '21:00'}
                                onChange={(e) => handleLogisticsChange('delivery.endTime', e.target.value)} className={input} />
                        </div>
                        <div>
                            <label className={label}>Slot Length (minutes)</label>
                            <input type="number" step="15" value={editLogistics.delivery?.slotMinutes ?? 60}
                                onChange={(e) => handleLogisticsChange('delivery.slotMinutes', parseInt(e.target.value, 10) || 60)} className={input} />
                        </div>
                        <div>
                            <label className={label}>Restock Days</label>
                            <input type="number" step="1" value={editLogistics.restockDays ?? 2}
                                onChange={(e) => handleLogisticsChange('restockDays', parseInt(e.target.value, 10) || 0)} className={input} />
                            <p className="text-[11px] text-stone-400 font-mono mt-1">
                                Turnaround after a bike's due-back date before it can go out again. Drives the
                                "expected availability" date customers see when a model is fully rented.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Stripe ──────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className={card}>
                    <h2 className="text-xl font-black uppercase text-black flex items-center gap-2 mb-4">
                        <CreditCard size={24} className="text-brand-green-dark" /> Stripe Keys
                    </h2>
                    <div>
                        <label className={label}>Publishable Key</label>
                        <input type="text" value={editConfig.stripe.publishableKey}
                            onChange={(e) => handleChange('stripe.publishableKey', e.target.value)} className={input} />
                    </div>
                    {/* SECURITY: the Stripe secret key and webhook signing secret are NOT
                        edited or displayed here. They live only in the server-only
                        `apiConfigSecret/stripe` document (Firestore rules deny it to every
                        client) and are read by the Cloud Functions admin SDK. Rendering a
                        secret key in a browser input — and saving it into the client-readable
                        `apiConfig/global` doc — exposed it to anyone who could read that doc.
                        Manage these secrets via the Firebase console / functions config. */}
                    <div className="border-2 border-dashed border-stone-300 bg-stone-50 p-3 text-[11px] font-mono text-stone-500 leading-relaxed">
                        Secret key &amp; webhook secret are managed server-side in
                        <span className="font-bold"> apiConfigSecret/stripe</span> and are not editable here.
                    </div>
                    <div>
                        <label className={label}>Merchant ID</label>
                        <input type="text" value={editConfig.stripe.merchantId}
                            onChange={(e) => handleChange('stripe.merchantId', e.target.value)} className={input} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={label}>Processing Fee (%)</label>
                            <input type="number" step="0.001" value={editConfig.stripe.processingFee * 100}
                                onChange={(e) => handleNumericChange('stripe.processingFee', (parseFloat(e.target.value) / 100).toString())} className={input} />
                        </div>
                        <div>
                            <label className={label}>Flat Fee ($)</label>
                            <input type="number" step="0.01" value={editConfig.stripe.transactionFee}
                                onChange={(e) => handleNumericChange('stripe.transactionFee', e.target.value)} className={input} />
                        </div>
                    </div>
                </div>

                {/* ── External services ───────────────────────────────────────── */}
                <div className={card}>
                    <h2 className="text-xl font-black uppercase text-black flex items-center gap-2 mb-4">
                        <Settings size={24} className="text-brand-green-dark" /> External Services
                    </h2>
                    <div>
                        <label className={label}>Google Maps API Key</label>
                        <input type="text" value={editConfig.apiKeys.googleMap}
                            onChange={(e) => handleChange('apiKeys.googleMap', e.target.value)} className={input} />
                    </div>
                    <div>
                        <label className={label}>Support Phone Number</label>
                        <input type="text" value={editConfig.supportPhoneNumber}
                            onChange={(e) => handleChange('supportPhoneNumber', e.target.value)} className={input} />
                    </div>
                    <div>
                        <label className={label}>Promo Cost Per Impression ($)</label>
                        <input type="number" step="0.001" value={editConfig.promoCostPerCount}
                            onChange={(e) => handleNumericChange('promoCostPerCount', e.target.value)} className={input} />
                    </div>
                    <div className="flex items-start gap-2 pt-2 text-[11px] text-stone-500 font-mono">
                        <Package size={14} className="shrink-0 mt-0.5" />
                        <span>
                            Foodyzz owns its bikes, so there is no provider commission or payout split —
                            rental revenue lands directly in this Stripe account.
                        </span>
                    </div>
                </div>
            </div>

            <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-black text-white p-4 rounded-md font-black uppercase text-lg shadow-brutalist-green border-2 border-black hover:bg-brand-green hover:text-black transition-colors flex items-center justify-center gap-3"
            >
                {saving ? (
                    <>
                        <AlertTriangle size={20} className="animate-spin" /> Saving...
                    </>
                ) : (
                    <>
                        <Save size={20} /> Save All Changes
                    </>
                )}
            </button>
        </div>
    );
}
