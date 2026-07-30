const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_API_BASE_URL =
  process.env.ASAAS_API_BASE_URL ||
  (String(process.env.ASAAS_ENV || "").toLowerCase() === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://fitbodyproapp.com",
  "https://www.fitbodyproapp.com",
];

function getAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
}

function isApprovedStatus(status) {
  return ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(
    String(status || "").toUpperCase(),
  );
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  res.setHeader("Access-Control-Allow-Credentials", true);
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Método não permitido" });
  }

  if (origin && !allowOrigin) {
    return res.status(403).json({ message: "Origem não permitida." });
  }

  try {
    if (!ASAAS_API_KEY) {
      return res
        .status(500)
        .json({ message: "ASAAS_API_KEY não configurada." });
    }

    const { paymentId } = req.body || {};

    if (!paymentId) {
      return res.status(400).json({ message: "ID do pagamento obrigatório." });
    }

    const response = await fetch(
      `${ASAAS_API_BASE_URL}/payments/${paymentId}`,
      {
        headers: {
          accept: "application/json",
          "User-Agent": "FitBodyPro/1.0.0",
          access_token: ASAAS_API_KEY,
        },
      },
    );

    const paymentData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        message:
          paymentData?.errors
            ?.map((item) => item.description || item.code)
            .join(" | ") ||
          paymentData?.message ||
          "Não foi possível consultar o pagamento no Asaas.",
        data: paymentData,
      });
    }

    return res.status(200).json({
      approved: isApprovedStatus(paymentData.status),
      status: paymentData.status,
    });
  } catch (error) {
    console.error("Check Payment Error:", error);
    return res
      .status(500)
      .json({ message: "Erro interno do servidor", error: error.message });
  }
};
