'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getBillingSettingsOffline, saveBillingSettingsOffline } from '@/lib/offline-service';
import { fileToResizedDataUrl } from '@/lib/image-utils';
import { ArrowLeft, Save, Store, UserRound, MapPin, Phone, Hash, Percent, Smartphone, PenLine, QrCode, Tag, HeartHandshake, ScrollText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BillingSettings } from '@/lib/types';

export default function BillingSettingsScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);

  const [form, setForm] = useState<BillingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sigInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      try {
        const settings = await getBillingSettingsOffline(user.id);
        if (!cancelled) setForm(settings);
      } catch {
        toast.error(t('error', language));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, language]);

  const update = <K extends keyof BillingSettings>(key: K, value: BillingSettings[K]) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = useCallback(async () => {
    if (!user?.id || !form) return;
    setSaving(true);
    try {
      const saved = await saveBillingSettingsOffline(user.id, form);
      setForm(saved);
      toast.success(t('saved', language));
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setSaving(false);
    }
  }, [user?.id, form, language]);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'signature' | 'qr') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = kind === 'signature'
        ? await fileToResizedDataUrl(file, 500, 120 * 1024)
        : await fileToResizedDataUrl(file, 700, 250 * 1024);
      if (kind === 'signature') update('signatureDataUrl', dataUrl);
      else update('qrCodeDataUrl', dataUrl);
      toast.success(t('saved', language) + ' — ' + t('save', language));
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    }
    e.target.value = '';
  };

  const ImageUploadRow = ({ kind, icon: Icon, label, dataUrl }: { kind: 'signature' | 'qr'; icon: React.ElementType; label: string; dataUrl: string }) => (
    <div className="glass-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <Icon size={18} className="text-emerald-400" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-24 h-20 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
          {dataUrl ? (
             
            <img src={dataUrl} alt={label} className="max-w-full max-h-full object-contain bg-white/80 rounded" />
          ) : (
            <span className="text-[10px] text-white/30 px-2 text-center">{t('uploadImage', language)}</span>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1">
          <button
            onClick={() => (kind === 'signature' ? sigInputRef : qrInputRef).current?.click()}
            className="glass-card py-2 text-xs font-medium text-emerald-400"
          >
            {dataUrl ? t('edit', language) : t('uploadImage', language)}
          </button>
          {dataUrl && (
            <button
              onClick={() => update(kind === 'signature' ? 'signatureDataUrl' : 'qrCodeDataUrl', '')}
              className="py-2 text-xs text-red-400/80 hover:text-red-400"
            >
              {t('removeImage', language)}
            </button>
          )}
        </div>
      </div>
      <input
        type="file"
        accept="image/*"
        ref={kind === 'signature' ? sigInputRef : qrInputRef}
        onChange={(e) => handleImagePick(e, kind)}
        className="hidden"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="animated-bg min-h-screen pb-24">
        <div className="max-w-md mx-auto px-4 pt-4">
          <Header goBack={goBack} title={t('billingSettings', language)} />
          <div className="text-center py-12 text-white/40">{t('loading', language)}</div>
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="animated-bg min-h-screen pb-32">
      <div className="max-w-md mx-auto px-4 pt-4">
        <Header goBack={goBack} title={t('billingSettings', language)} />

        <div className="space-y-3">
          {/* Shop identity */}
          <div className="glass-card-strong p-5 space-y-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('shopName', language)}</p>
            <Field icon={Store} label={t('shopName', language)} value={form.shopName} onChange={(v) => update('shopName', v)} placeholder="PS TELECOM" />
            <Field icon={UserRound} label={t('proprietorName', language)} value={form.proprietorName} onChange={(v) => update('proprietorName', v)} placeholder="Avijit Maity & Brother" />
            <Field icon={MapPin} label={t('shopAddress', language)} value={form.shopAddress} onChange={(v) => update('shopAddress', v)} placeholder="" multiline />
            <Field icon={Phone} label={t('shopPhone', language)} value={form.shopPhone} onChange={(v) => update('shopPhone', v)} placeholder="98xxxxxxxx" type="tel" />
          </div>

          {/* GST */}
          <div className="glass-card-strong p-5 space-y-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">GST</p>
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Hash size={18} className="text-emerald-400" />
                <span className="text-sm">{t('enableGst', language)}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.gstEnabled}
                onClick={() => update('gstEnabled', !form.gstEnabled)}
                className={`w-11 h-6 rounded-full transition-all relative ${form.gstEnabled ? 'bg-emerald-500/60' : 'bg-white/15'}`}
              >
                <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${form.gstEnabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </label>
            {form.gstEnabled && (
              <>
                <Field icon={Hash} label={t('gstNumberLabel', language)} value={form.gstNumber} onChange={(v) => update('gstNumber', v.toUpperCase())} placeholder="XXXXXXXXXXXXXXX" />
                <Field icon={Percent} label={t('gstRate', language)} value={String(form.gstRate)} onChange={(v) => update('gstRate', Number(v) || 0)} placeholder="18" type="number" />
              </>
            )}
            <Field icon={Percent} label={t('defaultDiscount', language)} value={String(form.defaultDiscountPercent || '')} onChange={(v) => update('defaultDiscountPercent', Number(v) || 0)} placeholder="0" type="number" />
          </div>

          {/* Payment */}
          <div className="glass-card-strong p-5 space-y-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('paymentQr', language)}</p>
            <Field icon={Smartphone} label={t('upiId', language)} value={form.upiId} onChange={(v) => update('upiId', v)} placeholder="name@upi" />
          </div>

          {/* Images */}
          <ImageUploadRow kind="signature" icon={PenLine} label={t('signature', language)} dataUrl={form.signatureDataUrl} />
          <ImageUploadRow kind="qr" icon={QrCode} label={t('paymentQr', language)} dataUrl={form.qrCodeDataUrl} />

          {/* Bill extras */}
          <div className="glass-card-strong p-5 space-y-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('eBill', language)}</p>
            <Field icon={Tag} label={t('billPrefix', language)} value={form.billPrefix} onChange={(v) => update('billPrefix', v.toUpperCase())} placeholder="PS" />
            <Field icon={HeartHandshake} label={t('thankYouNote', language)} value={form.thankYouNote} onChange={(v) => update('thankYouNote', v)} placeholder="Thank you for your business!" multiline />
            <Field icon={ScrollText} label={t('termsText', language)} value={form.termsText} onChange={(v) => update('termsText', v)} placeholder="" multiline />
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            className="neon-btn-solid w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? t('loading', language) : t('save', language)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ goBack, title }: { goBack: () => void; title: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
        <ArrowLeft size={20} className="text-emerald-400" />
      </button>
      <h1 className="text-lg font-bold text-emerald-400">{title}</h1>
      <div className="w-10" />
    </div>
  );
}

function Field({ icon: Icon, label, value, onChange, placeholder, type = 'text', multiline }: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-white/60 mb-1 block">{label}</label>
      <div className="relative">
        {!multiline && <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />}
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="glass-input w-full px-4 py-3 text-sm resize-none"
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="glass-input w-full pl-10 pr-4 py-3 text-sm"
          />
        )}
      </div>
    </div>
  );
}
