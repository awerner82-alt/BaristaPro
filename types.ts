
export interface EspressoShot {
  id: string;
  timestamp: number;
  beanName: string;
  roastDate: string;
  dose: number; // Gramm
  yield: number; // Gramm
  time: number; // Sekunden
  temperature: number; // Celsius (informativ)
  maraXTempSetting: '0' | 'I' | 'II'; // Spezifisch für Lelit Mara X
  grindSetting: string;
  notes: string;
  flavorProfile: {
    sourness: number; // 1-5
    bitterness: number; // 1-5
    body: number; // 1-5
    sweetness: number; // 1-5
    overall: number; // 1-5
  };
}

export interface DialInAdvice {
  diagnosis: string;
  recommendation: string;
  adjustment: string;
  explanation: string;
}

export interface CoffeeSearchRecommendation {
  found: boolean;
  dose?: number;
  yield?: number;
  time?: number;
  temperature?: string;
  maraXSetting?: '0' | 'I' | 'II';
  description?: string;
  sources: { title: string; uri: string }[];
}
