// ── 离线居家人生 P0 —— 服务端 reimplement RemiWorld 天气 ──────────────────
// 逐字节移植自 web/src/lib/world/weather.ts:1-60。确定性纯函数：同一 6 小时 slot
// 必出同一天气（sin-hash）。rain / snow → indoorOnly（过滤户外行为）。
//
// 服务端（根 tsconfig、commonjs）无法 import web，故照 server/session/world_event.ts
// 先例自己实现；与 web 版的一致性由黄金 fixture 测试锁住。
//
// 注意：weatherAt 的 hash01 与 schedule.ts 的 hash01 是【不同算法】（这里是 sin-
// hash，schedule 是整数位运算），逐字节照搬 web 两份各自的实现，不要合并。

export type WeatherState = "clear" | "cloudy" | "rain" | "snow";

export interface WeatherProfile {
  state: WeatherState;
  label: string; // HUD: "晴" / "多云" / "小雨" / "雪"
  contextLine: string; // prompt situational context
  indoorOnly: boolean; // filters outdoor behaviors
  fogDensityMult: number; // 1.0 = normal
}

const PROFILES: Record<WeatherState, WeatherProfile> = {
  clear: {
    state: "clear",
    label: "晴",
    contextLine: "天气晴朗，阳光很好。",
    indoorOnly: false,
    fogDensityMult: 1.0,
  },
  cloudy: {
    state: "cloudy",
    label: "多云",
    contextLine: "天上有些云，光线柔和。",
    indoorOnly: false,
    fogDensityMult: 1.2,
  },
  rain: {
    state: "rain",
    label: "小雨",
    contextLine: "窗外下着小雨，能听到雨滴打在屋檐上的声音。",
    indoorOnly: true,
    fogDensityMult: 1.5,
  },
  snow: {
    state: "snow",
    label: "雪",
    contextLine: "外面在下雪，窗台上积了薄薄一层。",
    indoorOnly: true,
    fogDensityMult: 1.3,
  },
};

/** Simple deterministic hash: same 6-hour slot → same weather */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Get weather profile for a given timestamp. Deterministic per 6-hour slot. */
export function weatherAt(epochMs: number): WeatherProfile {
  const slot = Math.floor(epochMs / (6 * 3600_000));
  const h = hash01(slot);
  if (h < 0.45) return PROFILES.clear;
  if (h < 0.70) return PROFILES.cloudy;
  if (h < 0.90) return PROFILES.rain;
  return PROFILES.snow;
}

export function getWeatherProfile(state: WeatherState): WeatherProfile {
  return PROFILES[state];
}
