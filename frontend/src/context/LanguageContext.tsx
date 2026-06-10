import { createContext, useContext, useState, type ReactNode } from 'react'

export type Language = 'en' | 'sq'

const translations = {
  en: {
    dashboard: 'Dashboard',
    calendar: 'Calendar',
    search: 'Search',
    searchReservations: 'Search Reservations',
    reservations: 'Reservations',
    needsAttention: 'Needs Attention',
    properties: 'Properties',
    locks: 'Locks',
    toFix: 'To Fix',
    reports: 'Reports',
    expenses: 'Expenses',
    synchronization: 'Synchronization',
    users: 'Users',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    currentlyStaying: 'Currently staying',
    freeToday: 'Free today',
    upcoming: 'Upcoming',
    loading: 'Loading...',
    save: 'Save',
    delete: 'Delete',
    cancel: 'Cancel',
    add: 'Add',
    edit: 'Edit',
    notes: 'Notes',
    guest: 'Guest',
    apartment: 'Apartment',
    platform: 'Platform',
    paid: 'Paid',
    unpaid: 'Unpaid',
    nights: 'Nights',
    total: 'Total',
    nightlyPrice: 'Nightly price',
    markCleaned: 'Mark cleaned',
    markDirty: 'Mark needs cleaning',
    cleaned: 'Cleaned',
    maintenance: 'Maintenance',
    description: 'Description',
    reportIssue: 'Report issue',
    archive: 'Archive',
    restore: 'Restore',
    history: 'History',
    discount: 'Discount',
    attachments: 'Attachments',
    exportPdf: 'Export PDF',
    exportExcel: 'Export Excel',
    syncNow: 'Sync now',
    autoSync: 'Auto sync',
    syncLog: 'Sync log',
    taxes: 'Taxes',
    turnover: 'Turnover',
    profit: 'Profit',
    floor: 'Floor',
    wifi: 'Wi-Fi',
    wifiPassword: 'Wi-Fi Password',
    doorCode: 'Door code',
    lockbox: 'Lockbox',
    copy: 'Copy',
    copied: 'Copied!',
  },
  sq: {
    dashboard: 'Ballina',
    calendar: 'Kalendari',
    search: 'Kërko',
    searchReservations: 'Kërko Rezervime',
    reservations: 'Rezervimet',
    needsAttention: 'Kërkon Vëmendje',
    properties: 'Banesat',
    locks: 'Çelësat',
    toFix: 'Për Rregullim',
    reports: 'Raportet',
    expenses: 'Shpenzimet',
    synchronization: 'Sinkronizimi',
    users: 'Përdoruesit',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    currentlyStaying: 'Aktualisht qëndron',
    freeToday: 'Lirë sot',
    upcoming: 'Të ardhshme',
    loading: 'Duke ngarkuar...',
    save: 'Ruaj',
    delete: 'Fshi',
    cancel: 'Anulo',
    add: 'Shto',
    edit: 'Ndrysho',
    notes: 'Shënime',
    guest: 'Mysafiri',
    apartment: 'Banesa',
    platform: 'Platforma',
    paid: 'Paguar',
    unpaid: 'Pa paguar',
    nights: 'Netë',
    total: 'Gjithsej',
    nightlyPrice: 'Çmimi për natë',
    markCleaned: 'Shëno si pastruar',
    markDirty: 'Shëno si jo pastruar',
    cleaned: 'Pastruar',
    maintenance: 'Mirëmbajtje',
    description: 'Përshkrimi',
    reportIssue: 'Raporto problem',
    archive: 'Arkivo',
    restore: 'Rikthe',
    history: 'Historia',
    discount: 'Zbritje',
    attachments: 'Bashkëngjitje',
    exportPdf: 'Eksporto PDF',
    exportExcel: 'Eksporto Excel',
    syncNow: 'Sinkronizo tani',
    autoSync: 'Sinkronizim automatik',
    syncLog: 'Regjistri i sinkronizimit',
    taxes: 'Taksat',
    turnover: 'Xhiro',
    profit: 'Fitimi',
    floor: 'Kati',
    wifi: 'Wi-Fi',
    wifiPassword: 'Fjalëkalimi Wi-Fi',
    doorCode: 'Kodi i derës',
    lockbox: 'Kutia e çelësave',
    copy: 'Kopjo',
    copied: 'Kopjuar!',
  },
} satisfies Record<Language, Record<string, string>>

type TranslationKey = keyof typeof translations.en

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('pms.language') as Language) || 'en'
  })

  function setLanguage(lang: Language) {
    setLanguageState(lang)
    localStorage.setItem('pms.language', lang)
  }

  function t(key: TranslationKey): string {
    return translations[language][key] ?? translations.en[key] ?? key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
