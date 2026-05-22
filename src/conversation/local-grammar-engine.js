function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceCommonTerms(text, replacements) {
  let output = text;
  const notes = [];

  for (const [from, to] of Object.entries(replacements || {})) {
    if (!from || !to) {
      continue;
    }
    const regex = new RegExp(`\\b${escapeRegex(from)}\\b`, "gi");
    if (regex.test(output)) {
      output = output.replace(regex, to);
      notes.push(`Substituido: "${from}" -> "${to}"`);
    }
  }

  return { output, notes };
}

function runLocalCorrection({
  text,
  languageId,
  rules
}) {
  const input = String(text || "");
  let output = input;
  const notes = [];

  if (rules?.collapseSpaces) {
    const collapsed = output.replace(/\s+/g, " ").trim();
    if (collapsed !== output) {
      output = collapsed;
      notes.push("Espacos normalizados.");
    }
  }

  const replacementsByLanguage = rules?.commonReplacementsByLanguage || {};
  const languageReplacements = replacementsByLanguage[languageId] || {};
  const replacementResult = replaceCommonTerms(output, languageReplacements);
  output = replacementResult.output;
  notes.push(...replacementResult.notes);

  if (rules?.capitalizeFirstLetter && output.length > 0) {
    const capitalized = output.charAt(0).toUpperCase() + output.slice(1);
    if (capitalized !== output) {
      output = capitalized;
      notes.push("Primeira letra ajustada para maiuscula.");
    }
  }

  if (rules?.ensureEndingPunctuation && output.length > 0 && !/[.!?]$/.test(output)) {
    output = `${output}.`;
    notes.push("Pontuacao final adicionada.");
  }

  return {
    original: input,
    corrected: output,
    changed: output !== input,
    notes
  };
}

module.exports = {
  runLocalCorrection
};
