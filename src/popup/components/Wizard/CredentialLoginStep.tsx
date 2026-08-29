import React, { useEffect, useState, FormEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconInfo, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import styles from './WizardOverlay.module.css';

type Mode = 'login' | 'create';

interface CredentialLoginStepProps {
  onSuccess: (account: unknown) => void;
}

export default function CredentialLoginStep({ onSuccess }: CredentialLoginStepProps) {
  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await rpc<{ hasChecksums: boolean; count: number }>(
          'onboarding_credentialProbe',
        );
        if (cancelled) return;
        setMode(probe.hasChecksums ? 'login' : 'create');
      } catch {
        if (!cancelled) setMode('create');
      } finally {
        if (!cancelled) setProbed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const method =
        mode === 'login' ? 'onboarding_credentialLogin' : 'onboarding_credentialCreate';
      const result = await rpc<{
        ok: boolean;
        reason?: string;
        account?: unknown;
        bindError?: string;
      }>(method, { email, password, pin });

      if (!result?.ok) {
        if (result?.reason === 'not_found') {
          setError(t('wizard.credentialNotFound'));
          setMode('create');
        } else if (result?.reason === 'password_too_short') {
          setError(t('wizard.credentialPasswordShort'));
        } else if (result?.reason === 'password_needs_digit') {
          setError(t('wizard.credentialPasswordDigit'));
        } else if (result?.reason === 'password_needs_special') {
          setError(t('wizard.credentialPasswordSpecial'));
        } else if (result?.reason === 'pin_invalid') {
          setError(t('wizard.credentialPinInvalid'));
        } else if (result?.reason === 'email_invalid') {
          setError(t('wizard.credentialEmailInvalid'));
        } else {
          setError(t('wizard.credentialFailed'));
        }
        return;
      }
      if (result.bindError) {
        // Account created but X bind conflict — still proceed; user can unbind in User.
        console.warn('[credential]', result.bindError);
      }
      onSuccess(result.account);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!probed) {
    return (
      <div className={`${styles.step} ${styles.credentialStep}`}>
        <p className={styles.stepDesc}>{t('wizard.credentialChecking')}</p>
      </div>
    );
  }

  return (
    <div className={`${styles.step} ${styles.credentialStep}`}>
      <h2 className={styles.stepTitle}>
        {mode === 'login'
          ? t('wizard.credentialLoginTitle')
          : t('wizard.credentialCreateTitle')}
      </h2>

      <div className={styles.warningBox}>
        <IconWarning />
        <span>{t('wizard.credentialDisclaimer')}</span>
      </div>

      <form className={styles.credentialForm} onSubmit={submit}>
        <div className={styles.credentialFields}>
          <div className={styles.formGroup}>
            <label htmlFor="credential-email">{t('wizard.credentialEmail')}</label>
            <Input
              id="credential-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              required
              className={styles.credentialInput}
              value={email}
              onChange={(ev) => {
                setEmail(ev.target.value);
                setError('');
              }}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="credential-password">{t('wizard.password')}</label>
            <Input
              id="credential-password"
              name="password"
              type="password"
              showToggle
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              enterKeyHint="next"
              required
              minLength={12}
              className={`${styles.credentialInput} ${styles.credentialPassword}`}
              value={password}
              onChange={(ev) => {
                setPassword(ev.target.value);
                setError('');
              }}
              disabled={busy}
            />
            <div className={styles.hint}>{t('wizard.credentialPassword')}</div>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="credential-pin">{t('wizard.credentialPin')}</label>
            <Input
              id="credential-pin"
              name="pin"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              required
              minLength={4}
              maxLength={8}
              pattern="[0-9]{4,8}"
              className={styles.credentialInput}
              value={pin}
              onChange={(ev) => {
                setPin(ev.target.value.replace(/\D/g, '').slice(0, 8));
                setError('');
              }}
              disabled={busy}
            />
          </div>

          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}

          <div className={styles.stepActions}>
            <Button type="submit" disabled={busy}>
              {busy
                ? mode === 'login'
                  ? t('wizard.credentialLoggingIn')
                  : t('wizard.credentialCreating')
                : mode === 'login'
                  ? t('wizard.credentialLoginAction')
                  : t('wizard.credentialCreateAction')}
            </Button>
            <p className={styles.credentialPrivacy}>
              <IconInfo size={14} />
              <span>{t('wizard.credentialPrivacyNote')}</span>
            </p>
          </div>

          <p className={styles.credentialSwitch}>
            {mode === 'login' ? (
              <>
                {t('wizard.credentialNoAccount')}{' '}
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setMode('create');
                    setError('');
                  }}
                >
                  {t('wizard.credentialCreateLink')}
                </button>
              </>
            ) : (
              <>
                {t('wizard.credentialHaveAccount')}{' '}
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                >
                  {t('wizard.credentialLoginLink')}
                </button>
              </>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
