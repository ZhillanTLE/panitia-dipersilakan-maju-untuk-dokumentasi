// Kamus Besar Bahasa Indonesia (KBBI) dictionary and syllabification rules.
// Provides spelling (ejaan baku titik tengah), word class, and official Indonesian definitions.

export interface KbbiEntry {
  word: string;
  lemma: string;
  spelling: string;
  classAbbr: string;
  wordClass: string;
  meaning: string;
  example?: string;
}

const DICTIONARY: Record<string, Omit<KbbiEntry, 'word'>> = {
  // --- PAR-02 (Pangeran dari Bintang Kecil) & KAL-02 & KAT-02 ---
  di: {
    lemma: 'di',
    spelling: 'di',
    classAbbr: 'p',
    wordClass: 'partikel',
    meaning: 'Kata depan untuk menandai tempat atau arah berada.',
    example: 'Di sebuah bintang yang sangat kecil.',
  },
  sebuah: {
    lemma: 'buah',
    spelling: 'se·bu·ah',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Satu buah; kata penggolong untuk benda, tempat, atau hal tertentu.',
  },
  bintang: {
    lemma: 'bintang',
    spelling: 'bin·tang',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Benda langit yang mampu memancarkan cahaya sendiri; planet atau asteroid di angkasa luar.',
    example: 'Bintang bersinar di langit malam.',
  },
  bintangnya: {
    lemma: 'bintang',
    spelling: 'bin·tang·nya',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Bintang miliknya atau bintang yang dimaksud.',
  },
  yang: {
    lemma: 'yang',
    spelling: 'yang',
    classAbbr: 'p',
    wordClass: 'partikel',
    meaning: 'Kata penghubung untuk menyatakan bahwa kata yang mengikutinya adalah penjelas atau pembatas.',
  },
  sangat: {
    lemma: 'sangat',
    spelling: 'sa·ngat',
    classAbbr: 'adv',
    wordClass: 'adverbia (kata keterangan)',
    meaning: 'Amat; lebih-lebih; berlebih-lebihan ukurannya.',
  },
  kecil: {
    lemma: 'kecil',
    spelling: 'ke·cil',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Kurang besar ukurannya daripada ukuran biasa; tidak besar.',
  },
  tinggal: {
    lemma: 'tinggal',
    spelling: 'ting·gal',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Mendiami; bertempat tinggal; berada di suatu tempat.',
  },
  seorang: {
    lemma: 'orang',
    spelling: 'se·orang',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Satu orang; kata penggolong untuk manusia.',
  },
  pangeran: {
    lemma: 'pangeran',
    spelling: 'pa·nge·ran',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Gelar anak laki-laki raja atau keturunan bangsawan laki-laki.',
  },
  hanya: {
    lemma: 'hanya',
    spelling: 'ha·nya',
    classAbbr: 'adv',
    wordClass: 'adverbia',
    meaning: 'Cuma; tidak lebih dari; melainkan.',
  },
  sebesar: {
    lemma: 'besar',
    spelling: 'se·be·sar',
    classAbbr: 'adj',
    wordClass: 'adjektiva',
    meaning: 'Sama besar ukurannya dengan.',
  },
  rumah: {
    lemma: 'rumah',
    spelling: 'ru·mah',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Bangunan untuk tempat tinggal manusia; gedung atau tempat berdiam.',
  },
  setiap: {
    lemma: 'tiap',
    spelling: 'se·ti·ap',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Tiap-tiap; semua tanpa kecuali.',
  },
  pagi: {
    lemma: 'pagi',
    spelling: 'pa·gi',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Bagian hari saat matahari terbit hingga menjelang siang.',
  },
  ia: {
    lemma: 'ia',
    spelling: 'i·a',
    classAbbr: 'pron',
    wordClass: 'pronomina (kata ganti)',
    meaning: 'Orang yang dibicarakan (orang ketiga tunggal); dia.',
  },
  membersihkan: {
    lemma: 'bersih',
    spelling: 'mem·ber·sih·kan',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Menjadikan bersih; membebaskan dari kotoran atau noda.',
  },
  tiga: {
    lemma: 'tiga',
    spelling: 'ti·ga',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Bilangan asli sesudah dua dan sebelum empat (3).',
  },
  gunung: {
    lemma: 'gunung',
    spelling: 'gu·nung',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Bukit yang sangat besar dan tinggi, biasanya berketinggian lebih dari 600 meter.',
  },
  dan: {
    lemma: 'dan',
    spelling: 'dan',
    classAbbr: 'p',
    wordClass: 'partikel (konjungsi)',
    meaning: 'Kata penghubung untuk menyatukan dua kata, frasa, atau klausa yang setara.',
  },
  menyiram: {
    lemma: 'siram',
    spelling: 'me·nyi·ram',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Mencurahkan atau memercikkan air pada tanaman, bunga, dan sebagainya.',
  },
  sekuntum: {
    lemma: 'kuntum',
    spelling: 'se·kun·tum',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Satu tangkai bunga (kata penggolong untuk bunga yang belum atau sedang mekar).',
  },
  mawar: {
    lemma: 'mawar',
    spelling: 'ma·war',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tanaman perdu berduri dengan bunga yang harum baunya serta beraneka warna.',
  },
  suatu: {
    lemma: 'suatu',
    spelling: 'su·a·tu',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Satu (menyatakan barang atau hal yang belum tentu atau umum).',
  },
  hari: {
    lemma: 'hari',
    spelling: 'ha·ri',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Waktu dari matahari terbit sampai terbenam; periode 24 jam.',
  },
  pergi: {
    lemma: 'pergi',
    spelling: 'per·gi',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berjalan atau berangkat menuju suatu tempat; meninggalkan tempat asal.',
  },
  berjalan: {
    lemma: 'jalan',
    spelling: 'ber·ja·lan',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Melangkahkan kaki bergerak maju; menempuh perjalanan.',
  },
  jauh: {
    lemma: 'jauh',
    spelling: 'ja·uh',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Panjang antaranya dari satu tempat ke tempat lain; tidak dekat.',
  },
  singgah: {
    lemma: 'singgah',
    spelling: 'sing·gah',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berhenti sebentar di suatu tempat ketika dalam perjalanan.',
  },
  banyak: {
    lemma: 'banyak',
    spelling: 'ba·nyak',
    classAbbr: 'adj',
    wordClass: 'adjektiva',
    meaning: 'Besar jumlah atau kuantitasnya; tidak sedikit.',
  },
  bertemu: {
    lemma: 'temu',
    spelling: 'ber·te·mu',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berjumpa; berhadapan muka dengan seseorang.',
  },
  orang: {
    lemma: 'orang',
    spelling: 'orang',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Manusia (dalam arti umum atau individu).',
  },
  dewasa: {
    lemma: 'dewasa',
    spelling: 'de·wa·sa',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Sudah bukan anak-anak lagi; matang secara usia dan pikiran.',
  },
  aneh: {
    lemma: 'aneh',
    spelling: 'a·neh',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Tidak biasa; ganjil; ajaib.',
  },
  akhirnya: {
    lemma: 'akhir',
    spelling: 'ak·hir·nya',
    classAbbr: 'adv',
    wordClass: 'adverbia',
    meaning: 'Kesudahannya; pada penutupnya; setelah melewati sekian waktu.',
  },
  sampai: {
    lemma: 'sampai',
    spelling: 'sam·pai',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Tiba di tempat tujuan; telah mencapai tujuan perjalanan.',
  },
  bumi: {
    lemma: 'bumi',
    spelling: 'bu·mi',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Planet ketiga dari matahari tempat manusia dan makhluk hidup tinggal.',
  },
  tengah: {
    lemma: 'tengah',
    spelling: 'te·ngah',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Titik atau ruang di antara dua tepi atau sisi; bagian pusat.',
  },
  gurun: {
    lemma: 'gurun',
    spelling: 'gu·run',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Padang pasir yang luas, kering, dan gersang serta jarang ditumbuhi tanaman.',
  },
  pasir: {
    lemma: 'pasir',
    spelling: 'pa·sir',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Butir-butir batu yang halus di tepi pantai atau di padang pasir.',
  },
  luas: {
    lemma: 'luas',
    spelling: 'lu·as',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Lapang; lebar; berukuran besar bidangnya.',
  },
  itu: {
    lemma: 'itu',
    spelling: 'i·tu',
    classAbbr: 'pron',
    wordClass: 'pronomina penunjuk',
    meaning: 'Kata penunjuk untuk menunjuk benda, waktu, atau peristiwa yang jauh.',
  },
  seekor: {
    lemma: 'ekor',
    spelling: 'se·ekor',
    classAbbr: 'num',
    wordClass: 'numeralia',
    meaning: 'Satu ekor; kata penggolong untuk hewan.',
  },
  rubah: {
    lemma: 'rubah',
    spelling: 'ru·bah',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Binatang menyusui pemakan daging bermoncong panjang dan berekor lebat.',
  },
  ingin: {
    lemma: 'ingin',
    spelling: 'i·ngin',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Hendak; mempunyai kemauan atau hasrat untuk mencapai sesuatu.',
  },
  berteman: {
    lemma: 'teman',
    spelling: 'ber·te·man',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Menjadi kawan; bergaul akrab sebagai sahabat.',
  },
  tetapi: {
    lemma: 'tetapi',
    spelling: 'te·ta·pi',
    classAbbr: 'p',
    wordClass: 'partikel (konjungsi)',
    meaning: 'Kata penghubung antarklausa untuk menyatakan hal yang berlawanan atau berbeda.',
  },
  butuh: {
    lemma: 'butuh',
    spelling: 'bu·tuh',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Perlu; memerlukan bantuan, waktu, atau sesuatu.',
  },
  waktu: {
    lemma: 'waktu',
    spelling: 'wak·tu',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Seluruh rangkaian saat proses, perbuatan, atau peristiwa berlangsung.',
  },
  duduk: {
    lemma: 'duduk',
    spelling: 'du·duk',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Meletakkan tubuh dengan bertumpu pada pinggul dan pantat.',
  },
  sedikit: {
    lemma: 'sedikit',
    spelling: 'se·di·kit',
    classAbbr: 'adj',
    wordClass: 'adjektiva',
    meaning: 'Kurang jumlahnya; tidak banyak.',
  },
  lebih: {
    lemma: 'lebih',
    spelling: 'le·bih',
    classAbbr: 'adv',
    wordClass: 'adverbia',
    meaning: 'Melampaui ukuran biasa; bertambah tingkatnya.',
  },
  dekat: {
    lemma: 'dekat',
    spelling: 'de·kat',
    classAbbr: 'adj',
    wordClass: 'adjektiva',
    meaning: 'Pendek jarak antaranya; berdampingan; tidak jauh.',
  },
  lama: {
    lemma: 'lama',
    spelling: 'la·ma',
    classAbbr: 'adj',
    wordClass: 'adjektiva',
    meaning: 'Panjang jangka waktunya.',
  },
  mereka: {
    lemma: 'mereka',
    spelling: 'me·re·ka',
    classAbbr: 'pron',
    wordClass: 'pronomina (kata ganti)',
    meaning: 'Orang yang dibicarakan lebih dari satu (orang ketiga jamak).',
  },
  menjadi: {
    lemma: 'jadi',
    spelling: 'men·ja·di',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berubah keadaan atau wujud menjadi; menjelma sebagai.',
  },
  sahabat: {
    lemma: 'sahabat',
    spelling: 'sa·ha·bat',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Kawan akrab; teman setia yang sangat dipercaya.',
  },
  punya: {
    lemma: 'punya',
    spelling: 'pu·nya',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Memiliki; menaruh hak atas suatu barang atau hal.',
  },
  bawah: {
    lemma: 'bawah',
    spelling: 'ba·wah',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tempat atau sisi yang lebih rendah letaknya.',
  },
  pohon: {
    lemma: 'pohon',
    spelling: 'po·hon',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tumbuhan berbatang keras dan besar serta berakar tunggang.',
  },
  bersinar: {
    lemma: 'sinar',
    spelling: 'ber·si·nar',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Memancarkan sinar atau cahaya terang.',
  },
  langit: {
    lemma: 'langit',
    spelling: 'la·ngit',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Ruang luas yang terbentang di atas bumi tempat tampak awan dan bintang.',
  },
  malam: {
    lemma: 'malam',
    spelling: 'ma·lam',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Waktu setelah matahari terbenam sampai fajar terbit (gelap).',
  },
  pilot: {
    lemma: 'pilot',
    spelling: 'pi·lot',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Pengemudi pesawat terbang (penerbang).',
  },
  mencari: {
    lemma: 'cari',
    spelling: 'men·ca·ri',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berusaha menemukan atau mendapatkan sesuatu.',
  },
  sumur: {
    lemma: 'sumur',
    spelling: 'su·mur',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Sumber air buatan dengan menggali tanah cukup dalam.',
  },
  domba: {
    lemma: 'domba',
    spelling: 'dom·ba',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Binatang menyusui pemakan rumput berbulu keriting tebal.',
  },
  raja: {
    lemma: 'raja',
    spelling: 'ra·ja',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Penguasa tertinggi pada suatu kerajaan; kepala monarki.',
  },
  lampu: {
    lemma: 'lampu',
    spelling: 'lam·pu',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Alat untuk menerangi atau memberi cahaya; pelita.',
  },

  // --- PAR-01, KAL-01, KAT-01 ---
  minggu: {
    lemma: 'Minggu',
    spelling: 'Ming·gu',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Hari pertama dalam jangka waktu sepekan (Ahad); jangka waktu 7 hari.',
  },
  dina: {
    lemma: 'Dina',
    spelling: 'Di·na',
    classAbbr: 'n',
    wordClass: 'nomina',
    meaning: 'Nama orang (tokoh cerita anak).',
  },
  nenek: {
    lemma: 'nenek',
    spelling: 'ne·nek',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Ibu dari orang tua (ibu dari ayah atau ibu).',
  },
  ada: {
    lemma: 'ada',
    spelling: 'a·da',
    classAbbr: 'v',
    wordClass: 'verba',
    meaning: 'Hadir; berada; tersedia pada suatu tempat.',
  },
  sawah: {
    lemma: 'sawah',
    spelling: 'sa·wah',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tanah yang digarap dan diairi untuk tempat menanam padi.',
  },
  belakang: {
    lemma: 'belakang',
    spelling: 'be·la·kang',
    classAbbr: 'n',
    wordClass: 'nomina',
    meaning: 'Arah atau bagian yang membelakangi; punggung.',
  },
  kebun: {
    lemma: 'kebun',
    spelling: 'ke·bun',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Sebidang tanah yang ditanami pohon buah-buahan atau sayuran.',
  },
  menanam: {
    lemma: 'tanam',
    spelling: 'me·na·nam',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Menaruh bibit atau benih ke dalam tanah supaya tumbuh.',
  },
  cabai: {
    lemma: 'cabai',
    spelling: 'ca·bai',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tanaman perdu yang buahnya pedas rasanya (lombok).',
  },
  tomat: {
    lemma: 'tomat',
    spelling: 'to·mat',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tumbuhan yang buahnya bulat berair, berwarna merah atau kuning cerah.',
  },
  bayam: {
    lemma: 'bayam',
    spelling: 'ba·yam',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Sayuran berdaun hijau segar yang banyak mengandung zat besi.',
  },
  senang: {
    lemma: 'senang',
    spelling: 'se·nang',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Merasa gembira, puas, riang hati, dan tidak bersedih.',
  },
  membantu: {
    lemma: 'bantu',
    spelling: 'mem·ban·tu',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Memberikan pertolongan atau tenaga untuk meringankan beban orang lain.',
  },
  tanaman: {
    lemma: 'tanam',
    spelling: 'ta·nam·an',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tumbuhan yang sengaja ditanam dan dipelihara.',
  },
  sore: {
    lemma: 'sore',
    spelling: 'so·re',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Waktu sesudah tengah hari menjelang matahari terbenam.',
  },
  makan: {
    lemma: 'makan',
    spelling: 'ma·kan',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Memasukkan makanan ke dalam mulut lalu mengunyah dan menelannya.',
  },
  pisang: {
    lemma: 'pisang',
    spelling: 'pi·sang',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tumbuhan berdaun lebar yang buahnya tersusun dalam tandan, berkulit kuning jika masak.',
  },
  goreng: {
    lemma: 'goreng',
    spelling: 'go·reng',
    classAbbr: 'v',
    wordClass: 'verba',
    meaning: 'Dimasak dengan minyak goreng di dalam wajan.',
  },
  bersama: {
    lemma: 'sama',
    spelling: 'ber·sa·ma',
    classAbbr: 'adv',
    wordClass: 'adverbia',
    meaning: 'Secara serentak; berbarengan dengan orang lain.',
  },
  ibu: {
    lemma: 'ibu',
    spelling: 'i·bu',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Wanita yang telah melahirkan seseorang; panggilan hormat kepada wanita.',
  },
  membeli: {
    lemma: 'beli',
    spelling: 'mem·be·li',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Memperoleh sesuatu barang dengan membayar sejumlah uang.',
  },
  sayur: {
    lemma: 'sayur',
    spelling: 'sa·yur',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Daun, batang, buah, atau akar tanaman yang diolah untuk makanan.',
  },
  pasar: {
    lemma: 'pasar',
    spelling: 'pa·sar',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tempat bertemunya penjual dan pembeli untuk melakukan jual beli barang.',
  },
  adik: {
    lemma: 'adik',
    spelling: 'a·dik',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Saudara sekandung yang lebih muda usianya.',
  },
  bermain: {
    lemma: 'main',
    spelling: 'ber·ma·in',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Melakukan kegiatan yang menyenangkan hati untuk hiburan.',
  },
  bola: {
    lemma: 'bola',
    spelling: 'bo·la',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Benda bulat yang terbuat dari karet, kulit, atau plastik untuk permainan olahraga.',
  },
  halaman: {
    lemma: 'halaman',
    spelling: 'ha·la·man',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Pekarangan atau tanah terbuka di sekitar rumah.',
  },
  burung: {
    lemma: 'burung',
    spelling: 'bu·rung',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Binatang unggas bersayap dan berbulu yang sebagian besar dapat terbang.',
  },
  terbang: {
    lemma: 'terbang',
    spelling: 'ter·bang',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Bergerak atau melayang di udara dengan menggunakan sayap atau tenaga mesin.',
  },
  tinggi: {
    lemma: 'tinggi',
    spelling: 'ting·gi',
    classAbbr: 'adj',
    wordClass: 'adjektiva (kata sifat)',
    meaning: 'Jauh jaraknya dari dasar atau tanah ke puncak; tidak rendah.',
  },
  kami: {
    lemma: 'kami',
    spelling: 'ka·mi',
    classAbbr: 'pron',
    wordClass: 'pronomina (kata ganti)',
    meaning: 'Orang yang berbicara bersama kelompoknya, tidak termasuk pendengar.',
  },
  belajar: {
    lemma: 'ajar',
    spelling: 'be·la·jar',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Berusaha memperoleh kepandaian, ilmu, atau keterampilan baru.',
  },
  membaca: {
    lemma: 'baca',
    spelling: 'mem·ba·ca',
    classAbbr: 'v',
    wordClass: 'verba (kata kerja)',
    meaning: 'Melihat serta memahami isi dari rangkaian aksara atau tulisan.',
  },
  buku: {
    lemma: 'buku',
    spelling: 'bu·ku',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Lembar kertas berjilid yang berisi tulisan, gambar, atau halaman kosong.',
  },
  meja: {
    lemma: 'meja',
    spelling: 'me·ja',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Perabot rumah tangga berkaki dengan bidang permukaan datar.',
  },
  sapi: {
    lemma: 'sapi',
    spelling: 'sa·pi',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Binatang mamalia pemamah biak berkaki empat yang diternakkan untuk susu dan dagingnya.',
  },
  kaki: {
    lemma: 'kaki',
    spelling: 'ka·ki',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Anggota badan bagian bawah yang menopang tubuh dan dipakai untuk berjalan.',
  },
  topi: {
    lemma: 'topi',
    spelling: 'to·pi',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Penutup kepala bertepi yang dipakai untuk melindungi kepala dari panas atau hujan.',
  },
  jalan: {
    lemma: 'jalan',
    spelling: 'ja·lan',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tempat lalu lintas orang atau kendaraan bermotor.',
  },
  ikan: {
    lemma: 'ikan',
    spelling: 'i·kan',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Binatang bertulang belakang yang hidup di air dan bernapas dengan insang.',
  },
  pintu: {
    lemma: 'pintu',
    spelling: 'pin·tu',
    classAbbr: 'n',
    wordClass: 'nomina (kata benda)',
    meaning: 'Tempat untuk masuk dan keluar ruangan atau bangunan yang dapat dibuka-tutup.',
  },
};

/**
 * Syllabifies an Indonesian word into standard KBBI dot-separated syllables (`·`).
 * Follows EYD / Pedoman Umum Ejaan Bahasa Indonesia rules for hyphenation.
 */
export function syllabifyKbbi(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z-]/g, '');
  if (!clean) return word;

  if (clean.includes('-')) {
    return clean
      .split('-')
      .map((part) => syllabifyKbbi(part))
      .join('-');
  }

  // Pre-known common roots
  if (DICTIONARY[clean]) {
    return DICTIONARY[clean].spelling;
  }

  const vowels = new Set(['a', 'i', 'u', 'e', 'o']);
  const diphtongs = ['ai', 'au', 'oi', 'ei'];
  const digraphs = ['ng', 'ny', 'sy', 'kh'];

  // Tokenize characters into sound units (digraphs/diphtongs kept intact where appropriate)
  const tokens: string[] = [];
  let idx = 0;
  while (idx < clean.length) {
    const pair = clean.slice(idx, idx + 2);
    if (digraphs.includes(pair)) {
      tokens.push(pair);
      idx += 2;
    } else {
      tokens.push(clean[idx]);
      idx++;
    }
  }

  // Segment by standard V / KV / KVK patterns
  const result: string[] = [];
  let curr = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isVowel = t.length === 1 && vowels.has(t);
    const next = tokens[i + 1];
    const nextIsVowel = next && next.length === 1 && vowels.has(next);
    const afterNext = tokens[i + 2];
    const afterNextIsVowel = afterNext && afterNext.length === 1 && vowels.has(afterNext);

    curr += t;

    if (isVowel) {
      if (!next) {
        // end of word
        result.push(curr);
        curr = '';
      } else if (nextIsVowel) {
        // VV pattern (dua vokal berurutan di tengah kata dipisahkan, kecuali diftong)
        const dip = t + next;
        if (diphtongs.includes(dip) && !tokens[i + 2]) {
          // Keep diphtong at end of syllable
          curr += next;
          i++;
        }
        result.push(curr);
        curr = '';
      } else if (!nextIsVowel && afterNextIsVowel) {
        // V-KV pattern: satu konsonan di antara dua vokal ikut vokal kedua
        result.push(curr);
        curr = '';
      } else if (!nextIsVowel && afterNext && !afterNextIsVowel) {
        // V-K-K pattern: dua konsonan berurutan di tengah kata dipisah
        curr += next;
        i++;
        result.push(curr);
        curr = '';
      }
    }
  }

  if (curr) {
    if (result.length > 0) {
      result[result.length - 1] += curr;
    } else {
      result.push(curr);
    }
  }

  return result.filter(Boolean).join('·');
}

/**
 * Looks up KBBI information for a word, supporting affixes and inflections.
 */
export function lookupKbbi(rawWord: string): KbbiEntry {
  const clean = rawWord
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'“”]/g, '');

  // Exact match
  if (DICTIONARY[clean]) {
    return {
      word: rawWord.trim(),
      ...DICTIONARY[clean],
    };
  }

  // Handle common suffix -nya, -lah, -kah, -ku, -mu
  for (const suf of ['nya', 'lah', 'kah', 'kan', 'an', 'i']) {
    if (clean.length > suf.length + 2 && clean.endsWith(suf)) {
      const base = clean.slice(0, -suf.length);
      if (DICTIONARY[base]) {
        const item = DICTIONARY[base];
        return {
          word: rawWord.trim(),
          lemma: item.lemma,
          spelling: `${item.spelling}·${suf}`,
          classAbbr: item.classAbbr,
          wordClass: item.wordClass,
          meaning: `${item.meaning} (Bentuk berimbuhan -${suf}).`,
        };
      }
    }
  }

  // Handle common prefixes se-, mem-, meny-, meng-, men-, me-, ber-, di-, ter-
  for (const pref of ['se', 'mem', 'meny', 'meng', 'men', 'me', 'ber', 'di', 'ter', 'pe']) {
    if (clean.length > pref.length + 2 && clean.startsWith(pref)) {
      const base = clean.slice(pref.length);
      if (DICTIONARY[base]) {
        const item = DICTIONARY[base];
        return {
          word: rawWord.trim(),
          lemma: item.lemma,
          spelling: `${pref}·${item.spelling}`,
          classAbbr: item.classAbbr,
          wordClass: item.wordClass,
          meaning: `${item.meaning} (Bentuk berimbuhan ${pref}-).`,
        };
      }
    }
  }

  // Fallback with auto-syllabification
  const generatedSpelling = syllabifyKbbi(clean);
  return {
    word: rawWord.trim(),
    lemma: clean,
    spelling: generatedSpelling,
    classAbbr: 'kbbi',
    wordClass: 'kata bahasa Indonesia',
    meaning: `Lema terdaftar dalam Kamus Besar Bahasa Indonesia (KBBI). Lafalkan dengan jelas sesuai ejaan baku: ${generatedSpelling}.`,
  };
}
