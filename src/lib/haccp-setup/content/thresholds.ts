// FSA SFBB temperatures (°C). Single source for the questionnaire library.
export const THRESHOLDS = {
  fridge: { min: 0, max: 5 },
  freezer: { min: -30, max: -18 },
  cookCoreMin: 75,
  hotHoldMin: 63,
  reheatMin: 75,
  reheatMinScotland: 82,
  coolingMaxAfter90Min: 8,
  deliveryChilledMax: 5,
  deliveryFrozenMax: -15,
  dishwasherRinseMin: 82,
  probeIce: { min: -1, max: 1 },
  probeBoiling: { min: 99, max: 101 },
  hotFoodUpper: 100,
} as const
