import type { CardLevel, ChildLevel, Confidence, Consents, Source, WordStatus } from './types';

const decimal = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

// All user-facing copy, in Bahasa Indonesia (the web stand-in for strings.xml).
// Rules from CLAUDE.md: plain, non-diagnostic teacher copy; the same warm ending for
// every child; never "disleksia", "diagnosis", "gangguan" or "risiko".

export const LEVEL: Record<ChildLevel, string> = {
  pemula: 'Pemula',
  huruf: 'Huruf',
  suku_kata: 'Suku kata',
  kata: 'Kata',
  kalimat: 'Kalimat',
  paragraf: 'Paragraf',
};

export const CARD: Record<CardLevel, string> = {
  paragraf: 'Kartu paragraf',
  kalimat: 'Kartu kalimat',
  kata: 'Kartu kata',
  suku_kata: 'Kartu suku kata',
  huruf: 'Kartu huruf',
};

export const STATUS: Record<WordStatus, string> = {
  correct: 'Benar',
  substituted: 'Keliru dibaca',
  omitted: 'Terlewat',
  repeated: 'Diulang',
  self_corrected: 'Dibetulkan sendiri',
  uncertain: 'Perlu ditinjau',
  supplied: 'Dibacakan guru',
};

export const STATUS_HINT: Record<WordStatus, string> = {
  correct: 'Dibaca dengan tepat.',
  substituted: 'Murid membaca kata lain.',
  omitted: 'Kata tidak dibaca.',
  repeated: 'Dibaca lebih dari sekali. Tidak dihitung keliru.',
  self_corrected: 'Murid salah lalu membetulkan sendiri. Tidak dihitung keliru.',
  uncertain: 'Mesin ragu. Dengarkan lalu pilih statusnya.',
  supplied: 'Guru membacakan kata ini. Dihitung keliru.',
};

export const CONFIDENCE: Record<Confidence, string> = {
  high: 'tinggi',
  medium: 'sedang',
  low: 'rendah',
};

export const SOURCE: Record<Source, string> = {
  online: 'Suara daring',
  ondevice: 'Suara di perangkat',
  manual: 'Penanda guru',
  simulated: 'Simulasi',
};

export const CONSENT: Record<keyof Consents, string> = {
  assessment: 'Asesmen',
  audio_research: 'Rekaman riset',
  camera_mode_b: 'Kamera Mode B',
};

export const S = {
  brand: 'DengarBaca',
  nav: {
    kelas: 'Kelas',
    bacaan: 'Bacaan',
    tinjau: 'Tinjau',
    label: 'Navigasi utama',
    hint: {
      kelas: 'Siapkan murid dan lihat kelompok',
      bacaan: 'Dengarkan murid membaca',
      tinjau: 'Periksa bacaan dan konfirmasi tingkat',
    },
    pending: (n: number) => `${n} bacaan menunggu tinjauan`,
  },
  offlineReady: 'Siap tanpa internet',
  storageOff: 'Penyimpanan peramban mati. Data hilang saat tab ditutup.',

  // Siap membaca (cover)
  ready: {
    title: 'Siap membaca?',
    pick: 'Siapa yang membaca?',
    stage: {
      new: 'Belum dibaca',
      pending: 'Menunggu tinjauan',
      placed: (level: string) => `Tingkat ${level.toLowerCase()}`,
    },
    startLine: 'Mulai dari',
    tabsHint: 'Ganti kartu awal lewat penanda di tepi buku.',
    tabsLabel: 'Kartu awal',
    openCard: (card: string) => `Buka ${card.toLowerCase()}`,
    noStudents: 'Belum ada murid. Tambahkan kode murid di Kelas.',
    toKelas: 'Buka Kelas',
    startFrom: 'Mulai dari',
    open: 'Buka kartu',
    pickFirst: 'Pilih murid dulu',
    noConsent: (ref: string) => `${ref} belum punya persetujuan asesmen. Bacaan dinilai manual, tanpa rekaman.`,
  },

  engine: {
    label: 'Cara mendengar',
    online: {
      available: 'Chrome mengenali suara murid lewat internet. Selama membaca, suara dikirim ke layanan Google.',
      offline: 'Tidak ada internet. Sambungkan dulu, atau gunakan Penanda guru.',
      unsupported: 'Peramban ini tidak punya pengenal suara. Buka di Chrome, atau gunakan Penanda guru.',
    },
    ondevice: {
      available: 'Suara dikenali di perangkat ini. Tidak ada yang dikirim ke internet.',
      downloadable: 'Paket suara Bahasa Indonesia belum terpasang di peramban ini.',
      downloading: 'Paket suara sedang diunduh.',
      unavailable: 'Peramban ini tidak bisa mengenali Bahasa Indonesia di perangkat.',
      unsupported: 'Peramban ini tidak bisa mengenali suara tanpa internet. Gunakan Penanda guru.',
    },
    install: 'Pasang paket suara',
    installing: 'Memasang…',
    manual:
      'Ketuk kata yang sedang dibaca, atau tekan Spasi untuk maju. Nilai bacaannya nanti di Tinjau.',
    simulated: 'Pembaca tiruan untuk mencoba alur. Hasilnya ditandai simulasi dan tidak dihitung.',
  },

  // Bacaan (Tes)
  reading: {
    start: 'Mulai dengarkan',
    stop: 'Selesai',
    back: 'Kembali',
    armedHint: 'Minta murid membaca keras-keras. Tekan Mulai dengarkan saat murid siap.',
    armedLead: (ref: string) => `${ref} siap membaca`,
    dock: 'Kendali guru',
    tabsLabel: 'Kartu',
    tabsLocked: 'Kartu tidak bisa diganti saat murid membaca.',
    listening: 'Mendengarkan',
    marking: 'Menandai',
    stalled: (word: string) => `Bacakan katanya: “${word}”`,
    supplied: 'Sudah dibacakan',
    scoring: 'Menyimpan bacaan…',
    textSize: 'Ukuran huruf',
    micDenied: 'Mikrofon tidak diizinkan. Bacaan dilanjutkan dengan Penanda guru, tanpa rekaman.',
    micMissing: 'Mikrofon tidak tersedia. Bacaan dilanjutkan dengan Penanda guru, tanpa rekaman.',
    recognizerFailed: (code: string) =>
      `Pengenal suara berhenti (${code}). Lanjutkan dengan mengetuk kata yang sedang dibaca, atau tekan Spasi.`,
    recognizerSilent:
      'Mikrofon mendengar suara, tetapi pengenal suara belum mengenali satu kata pun, jadi sorotan tidak bergerak. Ketuk kata yang sedang dibaca, atau tekan Spasi.',
    recognizerNetwork:
      'Internet terputus, jadi pengenal suara berhenti. Lanjutkan dengan mengetuk kata yang sedang dibaca, atau tekan Spasi.',
    recognizerLanguage:
      'Chrome menolak paket suara Bahasa Indonesia (language-not-supported) walau melaporkannya siap. Lanjutkan dengan mengetuk kata yang sedang dibaca, atau tekan Spasi.',
    cancelled: 'Bacaan dibatalkan karena halaman ditinggalkan.',
    transcript: 'Mode pengembang. Abu-abu: tebakan sementara pengenal suara.',
    tapToFix: 'Sorotan pindah saat kata dikenali. Bila tertinggal, ketuk kata yang sedang dibaca.',
    voiceLine: (syllables: number, total: number) => `Mikrofon: ${syllables} dari ${total} suku kata terdengar.`,
    noVoice: 'Mikrofon: tidak dipakai.',
    recognizerLine: (h: { starts: number; results: number; error: string | null }) =>
      `Pengenal suara: ${h.results} hasil, mulai ${h.starts} kali${h.error ? `, galat terakhir ${h.error}` : ''}.`,
    transcriptPosition: (cursor: number, total: number) => `Sorotan di kata ${Math.min(cursor + 1, total)} dari ${total}.`,
    simulatedChip: 'Simulasi',
  },

  // Terima kasih (same for every child)
  thanks: {
    title: 'Terima kasih!',
    body: 'Kamu sudah selesai membaca.',
  },

  // Kartu berikutnya (teacher, under the book)
  next: {
    suggestion: 'Saran sementara',
    continueTo: (card: string) => `Lanjut ke ${card.toLowerCase()}`,
    stopHere: 'Cukup sampai di sini',
    retry: 'Ulangi kartu',
    finish: (ref: string) => `Selesai untuk ${ref}`,
    why: 'Kenapa?',
    whyEngine: (correct: number, total: number, needed: number, rule: string) =>
      `Hitungan mesin sebelum ditinjau: ${correct} dari ${total} benar. ${rule} lulus mulai ${needed}.`,
    whyManual: 'Tidak ada hitungan mesin untuk penanda guru. Tentukan sendiri, lalu nilai di Tinjau.',
    manualPick: 'Pilih kartu berikutnya',
    quality: (pct: number) =>
      `Suara kurang jelas: hanya ${pct}% rekaman berisi suara. Ulangi kartu, atau nilai manual di Tinjau.`,
    clipping: 'Suara terlalu keras dan pecah. Jauhkan perangkat sedikit lalu ulangi kartu.',
    otherCard: 'Kartu lain',
    pickTab:
      'Tidak ada hitungan mesin untuk penanda guru. Pilih kartu berikutnya lewat penanda di tepi buku, atau selesaikan bacaan.',
    tabsHint: 'Kartu lain bisa dibuka lewat penanda di tepi buku.',
  },

  done: {
    pending: (ref: string) => `Bacaan ${ref} tersimpan dan menunggu tinjauan guru.`,
    nextStudent: 'Murid berikutnya',
    nextStudentRef: (ref: string) => `Lanjut ke ${ref}`,
    allRead: 'Semua murid sudah dibaca.',
    review: 'Tinjau sekarang',
  },

  // Tinjau
  review: {
    title: 'Tinjau',
    intro: 'Dengarkan, betulkan kata yang keliru ditandai, lalu konfirmasi tingkat murid.',
    steps: {
      check: 'Periksa kata bertanda',
      cards: 'Hasil tiap kartu',
      decide: 'Konfirmasi tingkat',
    },
    flagsNone: 'Mesin tidak menandai satu kata pun. Dengarkan sekilas bila ada rekaman.',
    flagsOpen: (n: number) => `${n} kata ragu perlu Anda pilih statusnya.`,
    flagsDone: 'Kata ragu sudah Anda periksa semua.',
    flagsList: 'Kata yang ditandai mesin',
    heardAs: (h: string) => `terdengar “${h}”`,
    notHeard: 'tidak terdengar',
    nextFlag: 'Kata ragu berikutnya',
    legend: 'Arti tanda',
    legendSample: 'kata',
    pending: 'Menunggu tinjauan',
    confirmed: 'Sudah dikonfirmasi',
    empty: 'Belum ada bacaan untuk ditinjau.',
    emptyHint: 'Rekam bacaan di halaman Bacaan, atau buat satu bacaan simulasi untuk mencoba alur tinjau.',
    makeSimulated: 'Buat bacaan simulasi',
    pickSession: 'Pilih bacaan di daftar untuk mulai meninjau.',
    cards: (n: number) => `${n} kartu`,
    unresolved: (n: number) => `${n} perlu ditinjau`,
    simulated: 'Simulasi',
    heard: 'Terdengar',
    nothingHeard: 'Tidak terdengar',
    confidence: 'Keyakinan mesin',
    engineSaid: 'Hasil mesin',
    resetEdit: 'Kembalikan ke hasil mesin',
    play: 'Putar bagian ini',
    tapHint: 'Ketuk kata untuk mengubah statusnya.',
    manualHint: 'Penanda guru: semua kata dianggap benar sampai Anda menandai yang keliru.',
    prevPage: 'Halaman sebelumnya',
    nextPage: 'Halaman berikutnya',
    pageOf: (n: number, total: number) => `${n} / ${total}`,
    cardLine: (correct: number, total: number) => `${correct} dari ${total} benar`,
    passLine: (needed: number) => `lulus mulai ${needed}`,
    passed: 'Lulus',
    notPassed: 'Belum lulus',
    insertions: (n: number) => `${n} sisipan`,
    fluency: (seconds: number, wcpm: number) =>
      `${decimal.format(seconds)} detik, ${decimal.format(wcpm)} kata benar per menit`,
    fluencyNote: 'Perkiraan waktu dari peramban, belum dari model.',
    needsReview: (n: number) =>
      `${n} kata masih bertanda putus-putus. Dengarkan, lalu pilih statusnya sebelum mengonfirmasi.`,
    suggested: 'Saran tingkat',
    level: 'Tingkat',
    noLevel: (card: string) => `Belum bisa menentukan tingkat. ${card} belum dicoba.`,
    startMissing: (card: string) => `Mulai ${card.toLowerCase()}`,
    closeWithout: 'Tutup tanpa tingkat',
    pendingChip: 'Menunggu guru',
    confirmedChip: 'Dikonfirmasi',
    confirm: (level: string) => `Konfirmasi tingkat ${level}`,
    confirmSimulated: 'Selesai meninjau simulasi',
    confirmedToast: (level: string, ref: string) => `Tingkat ${level} dikonfirmasi untuk ${ref}`,
    simulatedToast: 'Simulasi selesai ditinjau. Tidak masuk ke Kelas.',
    closedToast: 'Bacaan ditutup tanpa tingkat',
    simulatedNote: 'Bacaan simulasi tidak pernah dihitung sebagai hasil murid.',
    audioKept: 'Rekaman disimpan karena ada persetujuan rekaman riset.',
    audioDeleted: 'Rekaman dihapus setelah ditinjau.',
    audioWillDelete: 'Rekaman akan dihapus setelah dikonfirmasi.',
    audioWillKeep: 'Rekaman disimpan setelah dikonfirmasi (persetujuan riset).',
    noAudio: 'Tidak ada rekaman.',
    timelineOnly: 'Tanpa suara: urutan kata dari bacaan simulasi.',
    group: 'Kelompok',
    activities: 'Aktivitas untuk kelompok ini',
    rules: 'Aturan',
    rulesNote: 'Ambang sementara (draf). Perlu disetujui tim sebelum dipakai dengan murid.',
    errorsCount: 'Dihitung keliru: keliru dibaca, terlewat, dibacakan guru, dan perlu ditinjau.',
  },

  audio: {
    play: 'Putar',
    pause: 'Jeda',
    seek: 'Posisi rekaman',
  },

  // Kelas
  kelas: {
    title: 'Kelas',
    summary: (students: number, confirmed: number) =>
      `${students} murid, ${confirmed} sudah punya tingkat terkonfirmasi.`,
    progressLabel: 'Kemajuan kelas',
    progress: {
      placed: (n: number) => `${n} sudah ada tingkat`,
      pending: (n: number) => `${n} menunggu tinjauan`,
      fresh: (n: number) => `${n} belum dibaca`,
    },
    readNext: (ref: string) => `Dengarkan ${ref}`,
    reviewNext: 'Tinjau bacaan',
    allPlaced: 'Semua murid sudah punya tingkat.',
    review: 'Tinjau',
    reread: 'Baca ulang',
    groupsEmpty: 'Kelompok muncul di sini setelah Anda mengonfirmasi tingkat murid di Tinjau.',
    groupCount: (n: number) => `${n} murid`,
    showActivities: 'Lihat aktivitas',
    hideActivities: 'Tutup aktivitas',
    groups: 'Kelompok',
    groupsNote: 'Kelompok hanya dibentuk dari tingkat yang sudah dikonfirmasi guru.',
    noGroupStudents: 'Belum ada murid di kelompok ini.',
    unplaced: 'Belum punya tingkat',
    students: 'Murid',
    studentsNote: 'Murid dicatat dengan kode, bukan nama. Urutan mengikuti kode.',
    consent: 'Persetujuan',
    level: 'Tingkat',
    pending: 'menunggu tinjauan',
    none: 'Belum ada',
    assess: 'Mulai bacaan',
    remove: 'Hapus',
    removeConfirm: (ref: string) => `Hapus ${ref} beserta semua bacaan dan rekamannya?`,
    removed: (ref: string) => `${ref} dihapus`,
    addLabel: 'Kode murid',
    addPlaceholder: 'mis. K2-09',
    add: 'Tambah murid',
    added: (ref: string) => `${ref} ditambahkan`,
    duplicate: 'Kode itu sudah dipakai.',
    cameraNote: 'Mode B belum tersedia di prototipe ini.',
    activityDraft: 'Draf, belum ditinjau pendidik',
    minutes: (n: number) => `${n} menit`,
    materials: 'Bahan',
    export: 'Unduh CSV',
    exportNote: 'Berisi kode murid dan tingkat terkonfirmasi. Tidak ada skor.',
    reset: 'Hapus semua data',
    resetConfirm: 'Hapus semua murid, bacaan, dan rekaman di perangkat ini? Tindakan ini tidak bisa dibatalkan.',
    resetDone: 'Semua data dihapus',
    cancel: 'Batal',
  },
} as const;
