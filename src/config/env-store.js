function getEnvValue(name) {
  const key = String(name || "").trim();
  if (!key) {
    return "";
  }
  return String(process.env[key] || "").trim();
}

function requireEnvValue(name, providerName) {
  const value = getEnvValue(name);
  if (!value) {
    throw new Error(`${providerName} API key is missing in .env (${name})`);
  }
  return value;
}

module.exports = {
  getEnvValue,
  requireEnvValue
};
