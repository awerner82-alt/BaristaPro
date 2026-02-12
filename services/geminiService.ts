
import { GoogleGenAI, Type } from "@google/genai";
import { EspressoShot, DialInAdvice, CoffeeSearchRecommendation } from "../types.ts";

export const searchCoffeeParameters = async (query: string): Promise<CoffeeSearchRecommendation> => {
  // Wir erstellen die Instanz erst beim Aufruf, um sicherzustellen, dass der aktuellste Key genutzt wird
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Suche nach Brühparametern (Brew Guide) für diesen Kaffee: "${query}". 
  Antworte ausschließlich in folgendem JSON-Format:
  {
    "found": boolean,
    "dose": number,
    "yield": number,
    "time": number,
    "temperature": "string",
    "maraXSetting": "0" | "I" | "II",
    "description": "string"
  }
  Falls es eine Lelit Mara X spezifische Empfehlung gibt, nenne die PID-Stufe (0, I, II). Wenn nichts gefunden wird, setze 'found' auf false.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "Du bist ein Barista-Experte. Suche online nach Rezepten. Antworte in validem JSON.",
        // Wir lassen responseMimeType weg, da Search Grounding oft Text mit Quellenangaben zurückgibt, 
        // was das strikte JSON-Parsing der API zum Absturz bringen kann.
      },
    });

    const text = response.text;
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => ({
        title: chunk.web?.title || "Quelle",
        uri: chunk.web?.uri || ""
      }))
      .filter((s: any) => s.uri) || [];

    // JSON aus dem Text extrahieren (falls die KI Markdown-Codeblöcke nutzt)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (jsonData) {
      return { ...jsonData, sources };
    }
    return { found: false, sources };
  } catch (e) {
    console.error("Search API Error:", e);
    return { found: false, sources: [] };
  }
};

export const getBaristaAdvice = async (shot: EspressoShot): Promise<DialInAdvice> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analysiere diesen Espresso-Shot basierend auf folgendem Setup:
    Maschine: Lelit Mara X (E61 Gruppe, PID-Stufe: ${shot.maraXTempSetting})
    Mühle: Varia VS3 (Single Dosing, stufenlos)
    
    Shot-Daten:
    Bohne: ${shot.beanName}
    Dosis (In): ${shot.dose}g
    Ertrag (Out): ${shot.yield}g
    Zeit: ${shot.time}s
    Eingestellter Mahlgrad: ${shot.grindSetting}
    
    Geschmacksprofil (1-5):
    Säure: ${shot.flavorProfile.sourness}
    Bitterkeit: ${shot.flavorProfile.bitterness}
    Körper: ${shot.flavorProfile.body}
    Süße: ${shot.flavorProfile.sweetness}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "Du bist ein Barista-Experte für Lelit Mara X und Varia VS3. Gib prägnante, deutsche Tipps im JSON-Format.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosis: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            adjustment: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ["diagnosis", "recommendation", "adjustment", "explanation"]
        }
      }
    });

    return JSON.parse(response.text.trim()) as DialInAdvice;
  } catch (error) {
    console.error("Advice API Error:", error);
    return {
      diagnosis: "Analyse momentan nicht möglich.",
      recommendation: "Mahlgrad nach Gefühl anpassen.",
      adjustment: "Leicht feiner/gröber probieren.",
      explanation: "Keine Verbindung zum Barista-Server."
    };
  }
};
