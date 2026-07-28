/**
 * Legacy nested catalogs for the unused `src/App.tsx` / `react-i18next` shell.
 * Live popup and content script use `public/locales/*.json` instead.
 * Do not add new content-page strings here — use `public/locales/` +
 * `src/content/i18n/fallback-en.ts`.
 */
export const resources = {
  en: {
    translation: {
      popup: {
        tagline: 'Nostr context for X',
        identity: 'Identity',
        ready: 'Ready',
        notConfigured: 'Not configured',
        remove: 'Remove',
        removeConfirm: 'Remove this Nostr key from local extension storage?',
        generate: 'Generate dedicated identity',
        orImport: 'or import',
        existingNsec: 'Existing nsec',
        import: 'Import identity',
        securityWarning:
          'PoC security: the nsec is stored unencrypted in this browser profile. Use a dedicated low-value key.',
        relays: 'Relays',
        configured: '{{count}} configured',
        relayHelp: 'One WebSocket URL per line',
        saveRelays: 'Save relays',
        cachedEvents: '{{count}} cached events',
        loading: 'Loading extension state…',
        createIdentity: 'Create or import a dedicated Nostr identity',
        identityReady: 'Identity ready',
        identityCreated: 'New dedicated Nostr identity created',
        identityImported: 'Nostr identity imported',
        identityRemoved: 'Local identity removed',
        relaysSaved: 'Relay configuration saved',
        unexpectedError: 'Unexpected error',
        stateLoadError: 'Could not load state',
        linkX: 'Link X account',
        linkXHelp:
          'Requires the active X account on an open x.com tab. Preview and confirm before posting proof text.',
        activeAccount: 'Active X account',
        activeAccountWaiting: 'Open x.com while logged in',
        activeAccountPartial: '@{{handle}} · waiting for numeric ID',
        activeAccountReady: '@{{handle}} · {{twitterId}}',
        prepareProof: 'Preview proof post',
        confirmProof: 'Confirm and open composer',
        cancelProof: 'Cancel linking',
        proofPreview: 'Proof text to post',
        destinationAccount: 'Destination account',
        alreadyProven: 'Already proven for this account',
        useExistingProof: 'Refresh verified link',
        proofPostId: 'Proof post ID or URL',
        captureProof: 'Verify and publish NIP-39 link',
        proofSessionActive:
          'Composer session active — post the exact text, then capture the ID',
        identityPublishAdd:
          'Twitter identity tags will be added. Existing tags and content are kept.',
        identityPublishRefresh:
          'Same X account — proof post ID will be updated. Other tags are kept.',
        identityPublishReplace:
          'This will replace @{{oldHandle}} ({{oldId}}) with @{{newHandle}} ({{newId}}) on your kind 10011.',
        identityPublishReplaceMalformed:
          'Existing Twitter tags are malformed and will be replaced: {{tags}}',
        identityPublishPreserved: '{{count}} other tag(s) preserved',
        identityPublishPrepare: 'Review kind 10011',
        identityPublishConfirm: 'Publish to relays',
        identityPublishConfirmReplace: 'Replace X identity and publish',
        identityPublishCancel: 'Cancel',
        identityPublishStale:
          'Your kind 10011 changed since the preview. Review the updated event.',
        identityVerifiedLocal: 'Identity verified locally',
        identityPendingLocal: 'Identity saved locally · verification pending',
        identityUnverifiedLocal: 'Identity saved locally · not fully verified',
        identityRelayDelivery: 'delivered to {{delivered}}/{{attempted}} relays',
        identityRelayPending: 'relay delivery pending',
        sync: 'WoT sync',
        syncIdle: 'Idle',
        syncRunning: 'Syncing…',
        syncComplete: 'Complete',
        syncError: 'Error',
        syncStopped: 'Stopped',
        startSync: 'Start sync',
        stopSync: 'Stop sync',
      },
    },
  },
  da: {
    translation: {
      popup: {
        tagline: 'Nostr-kontekst til X',
        identity: 'Identitet',
        ready: 'Klar',
        notConfigured: 'Ikke konfigureret',
        remove: 'Fjern',
        removeConfirm: 'Fjern denne Nostr-nøgle fra lokal udvidelseslagring?',
        generate: 'Opret dedikeret identitet',
        orImport: 'eller importér',
        existingNsec: 'Eksisterende nsec',
        import: 'Importér identitet',
        securityWarning:
          'PoC-sikkerhed: nsec gemmes ukrypteret i denne browserprofil. Brug en dedikeret nøgle uden høj værdi.',
        relays: 'Relæer',
        configured: '{{count}} konfigureret',
        relayHelp: 'Én WebSocket-URL pr. linje',
        saveRelays: 'Gem relæer',
        cachedEvents: '{{count}} cachede hændelser',
        loading: 'Indlæser udvidelsens tilstand…',
        createIdentity: 'Opret eller importér en dedikeret Nostr-identitet',
        identityReady: 'Identiteten er klar',
        identityCreated: 'Ny dedikeret Nostr-identitet oprettet',
        identityImported: 'Nostr-identitet importeret',
        identityRemoved: 'Lokal identitet fjernet',
        relaysSaved: 'Relækonfiguration gemt',
        unexpectedError: 'Uventet fejl',
        stateLoadError: 'Kunne ikke indlæse tilstanden',
        linkX: 'Link X-konto',
        linkXHelp:
          'Kræver den aktive X-konto på en åben x.com-fane. Forhåndsvis og bekræft før du poster bevistekst.',
        activeAccount: 'Aktiv X-konto',
        activeAccountWaiting: 'Åbn x.com mens du er logget ind',
        activeAccountPartial: '@{{handle}} · venter på numerisk id',
        activeAccountReady: '@{{handle}} · {{twitterId}}',
        prepareProof: 'Forhåndsvis bevisopslag',
        confirmProof: 'Bekræft og åbn composer',
        cancelProof: 'Annullér linking',
        proofPreview: 'Bevistekst der skal postes',
        destinationAccount: 'Destinationskonto',
        alreadyProven: 'Allerede bevist for denne konto',
        useExistingProof: 'Opdater verificeret link',
        proofPostId: 'Bevisopslags-id eller URL',
        captureProof: 'Verificér og udgiv NIP-39-link',
        proofSessionActive:
          'Composer-session aktiv — post den nøjagtige tekst, og fang derefter id’et',
        identityPublishAdd:
          'Twitter-identitetstags tilføjes. Eksisterende tags og indhold bevares.',
        identityPublishRefresh:
          'Samme X-konto — bevisopslags-id opdateres. Andre tags bevares.',
        identityPublishReplace:
          'Dette erstatter @{{oldHandle}} ({{oldId}}) med @{{newHandle}} ({{newId}}) på din kind 10011.',
        identityPublishReplaceMalformed:
          'Eksisterende Twitter-tags er ugyldige og vil blive erstattet: {{tags}}',
        identityPublishPreserved: '{{count}} andet/andre tag(s) bevaret',
        identityPublishPrepare: 'Gennemgå kind 10011',
        identityPublishConfirm: 'Udgiv til relæer',
        identityPublishConfirmReplace: 'Erstat X-identitet og udgiv',
        identityPublishCancel: 'Annullér',
        identityPublishStale:
          'Din kind 10011 er ændret siden forhåndsvisningen. Gennemgå den opdaterede hændelse.',
        identityVerifiedLocal: 'Identitet verificeret lokalt',
        identityPendingLocal: 'Identitet gemt lokalt · verifikation afventer',
        identityUnverifiedLocal: 'Identitet gemt lokalt · ikke fuldt verificeret',
        identityRelayDelivery: 'leveret til {{delivered}}/{{attempted}} relæer',
        identityRelayPending: 'relælevering afventer',
        sync: 'WoT-synk',
        syncIdle: 'Inaktiv',
        syncRunning: 'Synkroniserer…',
        syncComplete: 'Færdig',
        syncError: 'Fejl',
        syncStopped: 'Stoppet',
        startSync: 'Start synk',
        stopSync: 'Stop synk',
      },
    },
  },
} as const

export const i18nOptions = {
  resources,
  fallbackLng: 'en',
  supportedLngs: ['en', 'da'],
  load: 'languageOnly' as const,
  interpolation: {
    escapeValue: false,
  },
}
