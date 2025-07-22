export interface Word {
  code: string;
  text: string | null;
  indopak: string;
  lineNumber: number;
}

export interface Ayah {
  ayahNum: number;
  words: Word[];
}

export interface Surah {
  surahNum: number;
  ayahs: Ayah[];
}

export interface Page {
  pageNumber: number;
  hizb: number;
  juz: number;
  rub: number;
  surahs: Surah[];
}
