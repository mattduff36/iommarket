/** Douglas, Isle of Man. The opening camera stays centred on this point. */
export const ISLE_OF_MAN_CENTER: [number, number] = [-4.48, 54.15];

const HALF_LONGITUDE = 7.2;
const HALF_LATITUDE = 4.8;

/**
 * South-west and north-east corners of the opening view.
 * The window is symmetric around the island, so the island stays centred,
 * and it is wide enough to show most of the United Kingdom.
 */
export function defaultVisitorMapBounds(): [[number, number], [number, number]] {
  const [longitude, latitude] = ISLE_OF_MAN_CENTER;
  return [
    [longitude - HALF_LONGITUDE, latitude - HALF_LATITUDE],
    [longitude + HALF_LONGITUDE, latitude + HALF_LATITUDE],
  ];
}
