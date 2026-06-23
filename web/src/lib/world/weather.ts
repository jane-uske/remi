// ── RW-P2-3: 天气 v0（纯客户端，确定性） ────────────────────────────
// 4 种天气状态，从日期 hash 确定性派生，不用外部 API。
// 影响：天空色调、粒子效果、行为池过滤、prompt 情境。

export type WeatherState = "clear" | "cloudy" | "rain" | "snow";

export interface WeatherProfile {
  state: WeatherState;
  label: string;           // HUD: "晴" / "多云" / "小雨" / "雪"
  contextLine: string;     // prompt situational context
  indoorOnly: boolean;     // filters outdoor behaviors
  fogDensityMult: number;  // 1.0 = normal
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
