'use client';

import { Link2, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { PROFILE_ACCOUNT_INPUT_CLASS as accountPanelInputClass } from '@/components/profile/profile-account-panel';
import type { ProfileArchidektSettingsControls } from '@/hooks/use-profile-archidekt-settings';

export function ProfileArchidektSettingsPanel({ controls }: { controls: ProfileArchidektSettingsControls }) {
  const { copy: t } = useLanguage();
  const { archidektSettingsUsername, setArchidektSettingsUsername, archidektAutoImport,
    setArchidektAutoImport, savingArchidektSettings, handleSaveArchidektSettings } = controls;
  return (
<div className="mt-6 overflow-hidden rounded-xl border border-emerald-400/30 bg-emerald-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-emerald-300" />
                    <h3 className="font-semibold text-emerald-50">{t({ it: 'Sincronizzazione Archidekt', en: 'Archidekt sync' })}</h3>
                  </div>
                  <p className="mb-3 text-sm text-emerald-200/70">
                    {t({
                      it: 'Collega il tuo profilo pubblico Archidekt. Se attivi il controllo automatico, i nuovi mazzi Commander pubblici vengono aggiunti in background senza modificare quelli esistenti.',
                      en: 'Connect your public Archidekt profile. When automatic checks are enabled, new public Commander decks are added in the background without changing existing decks.',
                    })}
                  </p>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-emerald-100/90">
                      {t({ it: 'Il tuo username Archidekt', en: 'Your Archidekt username' })}
                    </label>
                    <Input
                      value={archidektSettingsUsername}
                      onChange={(event) => setArchidektSettingsUsername(event.target.value)}
                      placeholder={t({ it: 'Username Archidekt', en: 'Archidekt username' })}
                      className={accountPanelInputClass}
                    />
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-400/15 bg-black/15 p-3 text-sm text-emerald-100/90">
                      <input
                        type="checkbox"
                        checked={archidektAutoImport}
                        onChange={(event) => setArchidektAutoImport(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-emerald-500"
                      />
                      <span>
                        <span className="block font-medium">{t({ it: 'Importa automaticamente nuovi mazzi', en: 'Automatically import new decks' })}</span>
                        <span className="block text-xs text-emerald-200/65">{t({ it: 'Controllo una volta per apertura profilo, con limite API.', en: 'Checked once per profile opening, with API rate limiting.' })}</span>
                      </span>
                    </label>
                    <Button
                      onClick={handleSaveArchidektSettings}
                      disabled={savingArchidektSettings}
                      className="bg-gradient-to-r from-emerald-600 to-teal-700 shadow-[0_8px_24px_rgba(124,58,237,0.28)] hover:from-emerald-500 hover:to-teal-600"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savingArchidektSettings ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva Archidekt', en: 'Save Archidekt' })}
                    </Button>
                  </div>
                </div>
  );
}
