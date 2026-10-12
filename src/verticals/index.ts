/** Vertical preset registry. */
import type { Vertical } from "@/modules/merchants/types";
import { bar } from "./bar";
import { beerPub } from "./beer-pub";
import { carCare, cafe, fitness, salon } from "./others";
import { restaurant } from "./restaurant";
import { spa } from "./spa";
import type { VerticalPreset } from "./types";

export const VERTICAL_PRESETS: Record<Vertical, VerticalPreset> = {
  restaurant,
  bar,
  beer_pub: beerPub,
  cafe,
  salon,
  spa,
  fitness,
  car_care: carCare,
};

export function verticalPreset(vertical: Vertical): VerticalPreset {
  return VERTICAL_PRESETS[vertical] ?? restaurant;
}

/** Merchants used by the demo (one per showcase vertical). */
export const DEMO_VERTICALS: Vertical[] = ["restaurant", "bar", "beer_pub", "spa"];

export type { VerticalPreset } from "./types";
