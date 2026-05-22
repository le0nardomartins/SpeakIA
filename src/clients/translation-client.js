function normalizeIsoCode(languageIso6391) {
  const value = String(languageIso6391 || "").trim().toLowerCase();
  if (!value) {
    return "en";
  }
  return value;
}

async function translateText({ text, targetIso6391 }) {
  const sourceText = String(text || "").trim();
  if (!sourceText) {
    return "";
  }

  const to = normalizeIsoCode(targetIso6391);
  const moduleApi = await import("@vitalets/google-translate-api");
  const translate = moduleApi.translate || moduleApi.default?.translate;

  if (typeof translate !== "function") {
    throw new Error("Translation library is unavailable");
  }

  const result = await translate(sourceText, { to });
  return String(result?.text || "").trim();
}

module.exports = {
  translateText
};
