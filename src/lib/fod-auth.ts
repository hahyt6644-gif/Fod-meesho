import { randomUUID } from "node:crypto";
import { getMeeshoAuthConfig } from "./config";

type JsonObject = Record<string, unknown>;

const MEESHO_HOST = "https://prod.meeshoapi.com";
const OTPLESS_HOST = "https://user-auth.otpless.app";
const MEESHO_APP_ID = "com.meesho.supply";
const OTP_APP = "XN07RN1IQC548C9YK5I4";
const OTP_PACKAGE = "com.meesho.supply";
const OTP_SIGNATURE = "KW52bf9yS0NNlzPxoPALAFxirS55W5WdGycmH7eVEoQ";
const OTP_HASH = "KW52bf9yS0N";
const OTP_LOGIN_URI = `otpless.${OTP_APP.toLowerCase()}://otpless`;
const USER_AGENT = "okhttp/4.9.0";

export type RequestContext = {
  instanceId: string;
  gaid: string;
  sessionId: string;
};

export type MeeshoSession = {
  mobile: string;
  xo: string;
  userId: string;
  context: RequestContext;
};

export type LockedFod = {
  bucket: number | null;
  maxOfferValue: number | null;
  offerText: string | null;
  offerTitle: string | null;
};

const pendingOtps = new Map<
  string,
  {
    mobile: string;
    requestContext: RequestContext;
    xo: string;
    stateId: string;
    tsId: string;
    inId: string;
    deviceInfo: JsonObject;
    intent: { uid: string; token: string; asId: string };
    expiresAt: number;
  }
>();

function newRequestContext(): RequestContext {
  return {
    instanceId: randomUUID(),
    gaid: randomUUID(),
    sessionId: randomUUID(),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mobileDigits(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  return digits.length === 10 ? digits : "";
}

function getNested(object: JsonObject, path: string[]) {
  let current: unknown = object;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}

function deviceInfo(input: JsonObject = {}): JsonObject {
  const result: JsonObject = {};
  for (const key of [
    "platform",
    "vendor",
    "browser",
    "connection",
    "language",
    "cookieEnabled",
    "userAgent",
    "cpuArchitecture",
    "model",
    "androidVersion",
  ]) {
    const value = stringValue(input[key]);
    if (value) result[key] = value.slice(0, 300);
  }
  for (const key of ["screenWidth", "screenHeight", "timezoneOffset"]) {
    const value = Number(input[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  return result;
}

async function jsonHeaders(context: RequestContext, extra: Record<string, string> = {}) {
  const { apiAuth } = await getMeeshoAuthConfig();
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/4.9.0",
    Authorization: apiAuth,
    "App-Version": "29.2",
    "App-Version-Code": "862",
    "Instance-Id": context.instanceId,
    "APP-GAID": context.gaid,
    "App-Session-Count": "1",
    "Country-Iso": "in",
    "Application-Id": MEESHO_APP_ID,
    "App-Session-Id": context.sessionId,
    "APP-SDK-VERSION": "34",
    "APP-CLIENT-ID": "android",
    "SHIELD-SESSION-ID": "",
    "APP-ISO-LANGUAGE-CODE": "en",
    "MEESHO-USER-CONTEXT": "anonymous",
    ...extra,
  };
}

async function readJson(response: Response, code: string) {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as JsonObject | null;
    const providerMessage =
      typeof body?.error === "string"
        ? body.error
        : body?.error && typeof body.error === "object"
          ? String((body.error as JsonObject).message ?? (body.error as JsonObject).code ?? "")
          : String(body?.message ?? body?.code ?? "");
    throw new Error(
      `Meesho request failed (${response.status})${
        providerMessage.trim() ? `: ${providerMessage.trim().slice(0, 160)}` : ""
      }.`,
    );
  }
  try {
    return (await response.json()) as JsonObject;
  } catch {
    throw new Error("Meesho returned an invalid response.");
  }
}

async function getXo(context: RequestContext) {
  const response = await fetch(
    `${MEESHO_HOST}/api/1.0/anonymous/config`,
    {
      headers: await jsonHeaders(context),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const result = await readJson(response, "otp_request_failed");
  return (
    stringValue(result.xo) ||
    stringValue(getNested(result, ["xoox", "xo"])) ||
    ""
  );
}

export async function createAnonymousContext(
  clientDeviceInfo: JsonObject = {},
): Promise<{ requestContext: RequestContext; xo: string }> {
  const baseContext = newRequestContext();
  const requestContext = {
    ...baseContext,
    gaid: stringValue(clientDeviceInfo.gaid) || baseContext.gaid,
  };
  const xo = await getXo(requestContext);
  if (!xo) {
    throw new Error("Meesho did not return an anonymous session token.");
  }
  return { requestContext, xo };
}

function devicePayload(identity: JsonObject = {}) {
  const payload: JsonObject = {
    from_language_modal: false,
    offer_bucket: "",
  };
  const make = stringValue(identity.make ?? identity.brand) || null;
  const model = stringValue(identity.model) || null;
  const android = stringValue(identity.android ?? identity.os_version) || null;
  const os = stringValue(identity.os) || null;
  const platform = stringValue(identity.platform) || null;
  const browser = stringValue(identity.browser ?? identity.user_agent) || null;
  const language = stringValue(identity.language) || null;
  const carrier = stringValue(identity.carrier) || null;
  const connectionType = stringValue(identity.connection_type) || null;
  const referrerUrl = stringValue(identity.referrer_url) || null;
  const campaignId = stringValue(identity.campaign_id) || null;
  const installReferrer = stringValue(identity.install_referrer) || null;
  const screenDpi = numberValue(identity.screen_dpi);
  const screenWidth = numberValue(identity.screen_width);
  const screenHeight = numberValue(identity.screen_height);
  if (make) {
    payload.brand = make;
    payload.manufacturer = make;
  }
  if (model) payload.model = model;
  if (android) payload.os_version = android;
  if (os) payload.os = os;
  if (platform) payload.platform = platform;
  if (browser) payload.browser = browser;
  if (language) payload.language = language;
  if (carrier) payload.carrier = carrier;
  if (connectionType) payload.connection_type = connectionType;
  if (referrerUrl) payload.referrer_url = referrerUrl;
  if (campaignId) payload.campaign_id = campaignId;
  if (installReferrer) payload.install_referrer = installReferrer;
  if (screenDpi !== null) payload.screen_dpi = screenDpi;
  if (screenWidth !== null) payload.screen_width = screenWidth;
  if (screenHeight !== null) payload.screen_height = screenHeight;
  if (Array.isArray(identity.apps_installed)) {
    const apps = identity.apps_installed
      .filter((app) => app && typeof app === "object")
      .slice(0, 50);
    if (apps.length) payload.apps_installed = apps;
  }
  return payload;
}

async function anonymousHeaders(
  anonymousContext: { requestContext: RequestContext; xo: string },
  identity: JsonObject = {},
) {
  const { apiAuth, anonymousXo } = await getMeeshoAuthConfig();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/4.9.0",
    "Accept-Encoding": "gzip, deflate",
    Authorization: apiAuth,
    "App-Version": "29.2",
    "App-Version-Code": "862",
    "App-Session-Count": "1",
    "Country-Iso": "in",
    "Application-Id": MEESHO_APP_ID,
    "APP-SDK-VERSION": "34",
    "APP-CLIENT-ID": "android",
    "SHIELD-SESSION-ID": "",
    "APP-ISO-LANGUAGE-CODE": "en",
    "MEESHO-USER-CONTEXT": "anonymous",
    Xo: anonymousContext.xo || anonymousXo || "",
  };
  headers["Instance-Id"] = anonymousContext.requestContext.instanceId;
  headers["APP-GAID"] = anonymousContext.requestContext.gaid;
  headers["App-Session-Id"] = anonymousContext.requestContext.sessionId;
  const instanceId = stringValue(identity.instance_id);
  const gaid = stringValue(identity.gaid);
  const sessionId = stringValue(identity.session_id);
  if (instanceId) headers["Instance-Id"] = instanceId;
  if (gaid) headers["APP-GAID"] = gaid;
  if (sessionId) headers["App-Session-Id"] = sessionId;
  return headers;
}

async function requestJson(headers: Record<string, string>, path: string, body: JsonObject) {
  const response = await fetch(`${MEESHO_HOST}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonObject;
  if (!response.ok) {
    throw new Error(`Meesho FOD request failed (${response.status})`);
  }
  return payload;
}

function firstOrderBlock(payload: JsonObject): JsonObject {
  const block = payload.surgical_first_order_discount_v3;
  return block && typeof block === "object" ? (block as JsonObject) : {};
}

export function normalizeFodOffer(payload: JsonObject): LockedFod {
  const block = firstOrderBlock(payload);
  const offer: JsonObject = block.offer && typeof block.offer === "object"
    ? (block.offer as JsonObject)
    : {};
  const maxOfferValue =
    numberValue(offer.max_offer_value) ??
    numberValue(offer.offer_value) ??
    numberValue(offer.value);
  return {
    bucket:
      numberValue(block.offer_bucket) ?? numberValue(offer.offer_bucket),
    maxOfferValue,
    offerText:
      stringValue(offer.offer_text) ||
      stringValue(offer.offer_title?.toString()) ||
      null,
    offerTitle: stringValue(offer.offer_title) || null,
  };
}

export async function fetchAnonymousFod(
  identity: JsonObject = {},
  anonymousContext?: { requestContext: RequestContext; xo: string },
) {
  const context =
    anonymousContext ??
    (await createAnonymousContext(identity));
  const payload = await requestJson(
    await anonymousHeaders(context, identity),
    "/api/1.0/anonymous/fod-personalisation",
    devicePayload(identity),
  );
  return { offer: normalizeFodOffer(payload), context };
}

export async function requestOtp(
  mobile: string,
  clientDeviceInfo: JsonObject = {},
  anonymousContext?: { requestContext: RequestContext; xo: string },
) {
  const normalizedMobile = mobileDigits(mobile);
  if (!normalizedMobile) {
    throw new Error("Enter a valid 10-digit mobile number.");
  }
  const fingerprint = deviceInfo(clientDeviceInfo);
  const baseContext = newRequestContext();
  const requestContext = anonymousContext?.requestContext ?? {
    ...baseContext,
    gaid: stringValue(clientDeviceInfo.gaid) || baseContext.gaid,
  };
  const xo = anonymousContext?.xo || (await getXo(requestContext));
  const tsId = randomUUID();
  const inId = randomUUID();
  const stateUrl = new URL(`${OTPLESS_HOST}/v2/state`);
  stateUrl.searchParams.set("origin", "https://otpless.com");
  stateUrl.searchParams.set("version", "V3");
  stateUrl.searchParams.set("tsId", tsId);
  stateUrl.searchParams.set("inId", inId);
  stateUrl.searchParams.set("isHeadless", "true");
  stateUrl.searchParams.set("platform", "android");
  stateUrl.searchParams.set("isLoginPage", "false");
  stateUrl.searchParams.set("packageName", OTP_PACKAGE);
  stateUrl.searchParams.set("package", OTP_PACKAGE);
  stateUrl.searchParams.set("appId", OTP_APP);
  stateUrl.searchParams.set("loginUri", OTP_LOGIN_URI);
  stateUrl.searchParams.set("deviceInfo", JSON.stringify(fingerprint));

  const stateResponse = await fetch(stateUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  const stateResult = await readJson(stateResponse, "otp_request_failed");
  const stateId = stringValue(stateResult.state);
  if (!stateId) {
    throw new Error("OTP state could not be created.");
  }

  const appInfo = {
    platform: stringValue(fingerprint.platform) || "web",
    manufacturer: stringValue(fingerprint.vendor),
    androidVersion: stringValue(fingerprint.androidVersion),
    packageName: OTP_PACKAGE,
    model: stringValue(fingerprint.model),
    appSignature: OTP_SIGNATURE,
    hasTelegram: stringValue(clientDeviceInfo.hasTelegram) || "false",
    hasWhatsapp: stringValue(clientDeviceInfo.hasWhatsapp) || "false",
    sdkVersion: "1.0.9",
    inId,
    tsId,
    isSilentAuthSupported: "true",
    isWebAuthnSupported: "true",
    isCellularDataEnabled: stringValue(clientDeviceInfo.isCellularDataEnabled) || "false",
  };
  const metadata: JsonObject = {
    appInfo: JSON.stringify(appInfo),
    deviceInfo: JSON.stringify(fingerprint),
  };
  if (clientDeviceInfo.device_id_info && typeof clientDeviceInfo.device_id_info === "object") {
    metadata.deviceIdInfo = JSON.stringify(clientDeviceInfo.device_id_info);
  }
  const intentResponse = await fetch(
    `${OTPLESS_HOST}/v3/lp/user/transaction/intent/${encodeURIComponent(stateId)}`,
    {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        selectedCountryCode: "91",
        mobile: `91${normalizedMobile}`,
        silentAuthEnabled: false,
        hasWhatsapp: "true",
        metadata: JSON.stringify(metadata),
        triggerWebauthn: false,
        clientMetaData: '{"tid":"aolplendcndhshdd"}',
        asId: "",
        isViSnaWhitelisted: true,
        isAirtelSnaWhitelisted: true,
        isAutoIntent: true,
        origin: "https://otpless.com",
        deviceInfo: JSON.stringify(fingerprint),
        loginUri: OTP_LOGIN_URI,
        appId: OTP_APP,
        isHeadless: true,
        packageName: OTP_PACKAGE,
        package: OTP_PACKAGE,
        otpHash: OTP_HASH,
        platform: "HEADLESS",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const intentResult = await readJson(intentResponse, "otp_request_failed");
  const quantumLeap = (intentResult.quantumLeap ?? {}) as JsonObject;
  const intent = {
    uid: stringValue(quantumLeap.uid),
    token: stringValue(quantumLeap.channelAuthToken),
    asId: stringValue(quantumLeap.asId),
  };
  if (!intent.uid || !intent.token) {
    throw new Error("OTP request was not accepted.");
  }

  const challengeId = randomUUID();
  pendingOtps.set(challengeId, {
    mobile: normalizedMobile,
    requestContext,
    xo,
    stateId,
    tsId,
    inId,
    deviceInfo: fingerprint,
    intent,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return { challengeId, mobile: normalizedMobile };
}

export async function verifyOtp(challengeId: string, otp: string): Promise<MeeshoSession> {
  const pending = pendingOtps.get(challengeId);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingOtps.delete(challengeId);
    throw new Error("That OTP session has expired. Start again.");
  }
  if (!/^\d{4,8}$/.test(String(otp).trim())) {
    throw new Error("Enter the OTP sent to your mobile.");
  }

  const verifyResponse = await fetch(
    `${OTPLESS_HOST}/v3/lp/user/transaction/otp/${encodeURIComponent(pending.stateId)}`,
    {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        selectedCountryCode: "91",
        mobile: pending.mobile,
        otp: String(otp).trim(),
        value: `91${pending.mobile}`,
        isOTPAutoRead: false,
        otpAutoReadChannel: "SMS",
        uid: pending.intent.uid,
        token: pending.intent.token,
        asId: pending.intent.asId,
        origin: "https://otpless.com",
        version: "V4",
        tsId: pending.tsId,
        inId: pending.inId,
        deviceInfo: JSON.stringify(pending.deviceInfo),
        loginUri: OTP_LOGIN_URI,
        appId: OTP_APP,
        isHeadless: true,
        packageName: OTP_PACKAGE,
        platform: "HEADLESS",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const verifyResult = await readJson(verifyResponse, "otp_verify_failed");
  const oneTap = (verifyResult.oneTap ?? {}) as JsonObject;
  const authDetail = (verifyResult.authDetail ?? {}) as JsonObject;
  const otpToken =
    stringValue(oneTap.token) || stringValue(authDetail.token);
  const idToken =
    stringValue(getNested(oneTap, ["merchantUserInfo", "idToken"])) ||
    stringValue(authDetail.token);
  if (!otpToken || !idToken) {
    throw new Error("The OTP was not accepted.");
  }
  const aesKeyEncrypted =
    stringValue(verifyResult.aes_key_encrypted) ||
    stringValue(getNested(oneTap, ["merchantUserInfo", "aes_key_encrypted"])) ||
    stringValue(getNested(oneTap, ["sessionInfo", "aes_key_encrypted"]));
  const otplessPayload: JsonObject = {
    token: otpToken,
    id_token: idToken,
    version: "v1",
  };
  if (aesKeyEncrypted) otplessPayload.aes_key_encrypted = aesKeyEncrypted;

  const loginResponse = await fetch(`${MEESHO_HOST}/api/2.0/user/login`, {
    method: "POST",
    headers: await jsonHeaders(pending.requestContext, { Xo: pending.xo }),
    body: JSON.stringify({
      login_type: "otpless",
      otpless: otplessPayload,
      ...(pending.requestContext.gaid ? { ga_id: pending.requestContext.gaid } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const loginResult = await readJson(loginResponse, "login_failed");
  const session = normalizeSession(
    { mobile: pending.mobile, ...loginResult, login_response: loginResult },
    pending.mobile,
  );
  pendingOtps.delete(challengeId);
  return session;
}

function normalizeSession(input: JsonObject, fallbackMobile = ""): MeeshoSession {
  const loginResponse =
    input.login_response && typeof input.login_response === "object"
      ? (input.login_response as JsonObject)
      : input;
  const nestedUser =
    loginResponse.user && typeof loginResponse.user === "object"
      ? (loginResponse.user as JsonObject)
      : {};
  const mobile =
    mobileDigits(
      input.mobile ??
        input.phone ??
        loginResponse.mobile ??
        nestedUser.mobile ??
        fallbackMobile,
    ) || fallbackMobile;
  const xo =
    stringValue(input.xo) ||
    stringValue(input.token) ||
    stringValue(input.access_token) ||
    stringValue(loginResponse.token) ||
    stringValue(getNested(loginResponse, ["xoox", "xo"]));
  const userId =
    String(
      input.user_id ??
        input.userId ??
        loginResponse.id ??
        nestedUser.user_id ??
        nestedUser.id ??
        "",
    ).trim();
  const inputIdentity =
    input.identity && typeof input.identity === "object"
      ? (input.identity as JsonObject)
      : {};
  const context: RequestContext = {
    instanceId:
      stringValue(input.instance_id) ||
      stringValue(input.instanceId) ||
      stringValue(inputIdentity.instance_id) ||
      stringValue(inputIdentity.instanceId) ||
      randomUUID(),
    gaid:
      stringValue(input.gaid) ||
      stringValue(input.GAID) ||
      stringValue(inputIdentity.gaid) ||
      stringValue(inputIdentity.GAID) ||
      randomUUID(),
    sessionId:
      stringValue(inputIdentity.app_session_id) ||
      stringValue(inputIdentity.appSessionId) ||
      stringValue(input.app_session_id) ||
      stringValue(input.appSessionId) ||
      randomUUID(),
  };
  if (!mobile || !xo) {
    throw new Error("This session is missing mobile or session token.");
  }
  return { mobile, xo, userId, context };
}

async function sessionHeaders(session: MeeshoSession) {
  const { apiAuth } = await getMeeshoAuthConfig();
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/4.9.0",
    Authorization: apiAuth,
    "App-Version": "29.2",
    "App-Version-Code": "862",
    "Instance-Id": session.context.instanceId,
    "APP-GAID": session.context.gaid,
    "App-Session-Count": "1",
    "Country-Iso": "in",
    "Application-Id": MEESHO_APP_ID,
    "App-Session-Id": session.context.sessionId,
    "APP-SDK-VERSION": "34",
    "APP-CLIENT-ID": "android",
    "SHIELD-SESSION-ID": "",
    "APP-ISO-LANGUAGE-CODE": "en",
    "MEESHO-USER-CONTEXT": "logged_in",
    "App-User-Id": session.userId,
    Xo: session.xo,
  };
}

export async function fetchSessionFod(session: MeeshoSession) {
  const sessionContext: JsonObject = {};
  const payload = await requestJson(
    await sessionHeaders(session),
    "/api/1.0/anonymous/fod-personalisation",
    devicePayload(sessionContext),
  );
  return normalizeFodOffer(payload);
}

async function fetchSessionCart(session: MeeshoSession) {
  return requestJson(await sessionHeaders(session), "/api/8.0/cart", {
    context: "cart",
    identifier: "default",
    cart_session: null,
    dest_pin: null,
    address_id: null,
    customerAmount: null,
    payment_modes: [],
    replaceable: false,
    item: null,
    payment_instrument: null,
    bank_offers: null,
    filter_products: null,
    is_self_pickup: null,
    self_pickup_address: null,
    is_emi: null,
    user_id: Number.isSafeInteger(Number(session.userId))
      ? Number(session.userId)
      : undefined,
  });
}

export type AppliedFod = {
  status: "applied" | "not_applied" | "unknown";
  amount: number | null;
  text: string | null;
};

function normalizeAppliedFod(payload: JsonObject): AppliedFod {
  const result: JsonObject =
    payload.result && typeof payload.result === "object"
      ? (payload.result as JsonObject)
      : {};
  const firstOrder = (result.user_meta as JsonObject | undefined)?.is_first_order === true;
  const products = Array.isArray(result.splits)
    ? result.splits.flatMap((split: JsonObject) =>
        Array.isArray(split.products) ? split.products : [],
      )
    : [];
  const applied = products.flatMap((product: JsonObject) =>
    Array.isArray(product.offers_applied) ? product.offers_applied : [],
  );
  const banner = (result.offers as JsonObject | undefined)?.offers_banner as
    | JsonObject
    | undefined;
  const hasLiveOfferEvidence = applied.length > 0 || Boolean(banner);
  if (!firstOrder || !hasLiveOfferEvidence) {
    return {
      status: firstOrder ? "not_applied" : "unknown",
      amount: null,
      text: null,
    };
  }
  const offer: JsonObject =
    applied[0]?.offer && typeof applied[0].offer === "object"
      ? (applied[0].offer as JsonObject)
      : {};
  const discount = (result.price_break_up as JsonObject[] | undefined)
    ?.flatMap((entry: JsonObject) =>
      Array.isArray(entry.details) ? entry.details : [],
    )
    ?.find((entry: JsonObject) =>
      String(entry.type ?? "").toLowerCase().includes("offer"),
    );
  const rawAmount =
    numberValue((discount as JsonObject | undefined)?.value) ??
    numberValue((applied[0] as JsonObject | undefined)?.amount) ??
    numberValue((banner as JsonObject | undefined)?.amount);
  return {
    status: "applied",
    amount: rawAmount === null ? null : Math.abs(rawAmount),
    text: stringValue(banner?.offer_text) || stringValue(offer.name) || null,
  };
}

export async function checkFodValidity(session: MeeshoSession) {
  const [offerResult, cartResult] = await Promise.allSettled([
    fetchSessionFod(session),
    fetchSessionCart(session),
  ]);
  return {
    offer:
      offerResult.status === "fulfilled"
        ? offerResult.value
        : { bucket: null, maxOfferValue: null, offerText: null, offerTitle: null },
    applied:
      cartResult.status === "fulfilled"
        ? normalizeAppliedFod(cartResult.value)
        : { status: "unknown" as const, amount: null, text: null },
    is_first_order:
      cartResult.status === "fulfilled"
        ? ((cartResult.value.result as JsonObject | undefined)?.user_meta as JsonObject | undefined)
            ?.is_first_order === true
        : null,
  };
}