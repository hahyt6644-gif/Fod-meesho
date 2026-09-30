import { randomInt } from "node:crypto";

export type JsonObject = Record<string, any>;

const BRANDS: Array<[string, string[]]> = [
  ["samsung", ["SM-M315F", "SM-A525F", "SM-G991B", "SM-A236E", "SM-M127G", "GT-I9195"]],
  ["xiaomi", ["Redmi Note 10 Pro", "Redmi 9 Power", "POCO X3 Pro", "Redmi Note 11", "Mi 11 Lite"]],
  ["realme", ["realme 8 Pro", "realme C25S", "realme Narzo 30", "realme 7 Pro"]],
  ["oneplus", ["ONEPLUS A6003", "IN2025", "HD1901", "LE2121"]],
  ["oppo", ["CPH2069", "CPH2219", "CPH2505", "CPH2387"]],
  ["vivo", ["V2036", "V2045", "V2117", "V2011"]],
  ["motorola", ["motorola edge 20 pro", "moto g(60)", "moto g54", "motorola one fusion+"]],
  ["honor", ["Honor 8X", "HLK-AL00", "LRA-AL00"]],
];

const ANDROID_VERSIONS = ["10", "11", "12", "13", "14"];
const ANDROID_SDK = ["29", "30", "31", "32", "33", "34"];
const LANGUAGES = ["en", "hi", "en-IN", "hi-IN", "mr", "ta", "te", "bn", "gu", "kn"];
const CONNECTIONS = ["wifi", "wifi", "wifi", "cellular", "cellular"];
const CARRIERS = ["AirTel", "Jio", "Vodafone Idea", "BSNL", "MTNL"];

function pick<T>(list: T[]): T {
  return list[randomInt(list.length)];
}

const BASE_APPS = [
  { name: "com.whatsapp", package: "com.whatsapp", installed: true },
  { name: "com.google.android.gms", package: "com.google.android.gms", installed: true },
  { name: "com.google.android.youtube", package: "com.google.android.youtube", installed: true },
];

function randomApps(): JsonObject[] {
  const names = [
    "com.facebook.katana",
    "com.instagram.android",
    "in.amazon.mShop.android.shopping",
    "com.flipkart.android",
    "com.phonepe.app",
    "com.gpay",
    "com.paytm.app",
    "com.meesho.supply",
    "net.one97.paytm",
    "com.truecaller",
    "com.microsoft.office.outlook",
    "com.linkedin.android",
    "com.ubercab",
    "in.swiggy.android",
    "com.zomato.app",
    "com.olacabs.customer",
    "com.dbs.dbsapp",
    "com.google.android.apps.maps",
    "com.google.android.apps.photos",
    "com.microsoft.skype.teams.ipphone%2F",
  ];
  const extra = names.slice(0, randomInt(3, 10));
  return BASE_APPS.concat(
    extra.map((name) => ({ name, package: name, installed: true })),
  );
}


export function randomDeviceIdentity(): JsonObject {
  const [brand, models] = pick(BRANDS);
  const model = pick(models);
  const android = pick(ANDROID_VERSIONS);
  const uniqueId = randomInt(100000, 999999).toString();
  return {
    platform: "android",
    android,
    make: brand,
    brand,
    model,
    vendor: brand,
    os_version: android,
    os: `Android ${android}`,
    sdk: pick(ANDROID_SDK),
    language: pick(LANGUAGES),
    browser: `Mozilla/5.0 (Linux; Android ${android}; ${model} Build/RKQ1.${uniqueId}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1${pick(ANDROID_SDK)}.0.0.0 Mobile Safari/537.36`,
    user_agent: `Mozilla/5.0 (Linux; Android ${android}; ${model} Build/RKQ1.${uniqueId})`,
    connection: pick(CONNECTIONS),
    connection_type: pick(CONNECTIONS),
    carrier: pick(CARRIERS),
    cookie_enabled: "true",
    timezone_offset: pick([-330, 330, 0]),
    referrer_url: pick(["", "", "", "https://www.instagram.com/", "https://www.youtube.com/"]),
    campaign_id: pick(["", "", "fod153", "firstorder150", "newuser200"]),
    install_referrer: "utm_source=meesho-app-link",
    screen_dpi: pick([400, 420, 440, 480, 220, 260]),
    screen_width: pick([480, 720, 800, 1080, 1440]),
    screen_height: pick([800, 1280, 1600, 1920, 2340]),
    cpu_arch: pick(["arm64-v8a", "armeabi-v7a"]),
    apps_installed: randomApps(),
  };
}