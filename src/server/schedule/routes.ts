/**
 * Route optimisation (brief §4.4, slice 35), as pure functions.
 *
 * The dispatcher already has the day's visits dated and staffed; this decides what order to drive
 * them in. Finding the shortest open path through a dozen sites is the travelling-salesman problem,
 * which is only exactly solvable by brute force at sizes no working day reaches — so this is a
 * nearest-neighbour pass followed by 2-opt improvement, which lands within a few per cent of the
 * best round and is instant.
 *
 * It is an **open path**, not a circuit: there is no depot in the system, so the first stop is a
 * decision the office has already made (the earliest-scheduled visit keeps its slot) and the rest are
 * ordered from there. The caller says where the drive starts; this file only knows points.
 */

export interface RoutePoint {
  id: string
  latitude: number
  longitude: number
}

export interface RoutePlan {
  /** The point ids in visiting order, starting with the one the caller named. */
  ids: string[]
  /** Kilometres of each leg. The first entry is 0 — nothing comes before the first stop. */
  legs: number[]
  totalKm: number
}

/** IUGG mean Earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371.0088

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/**
 * Great-circle kilometres between two points.
 *
 * A sphere rather than the WGS-84 ellipsoid: the error is under 0.5%, and a round that is 0.3 km
 * pessimistic does not change which site a technician drives to next. Road distance is longer than
 * this line in any case — the route is a driving order, not a mileage claim.
 */
export function distanceKm(
  a: Pick<RoutePoint, 'latitude' | 'longitude'>,
  b: Pick<RoutePoint, 'latitude' | 'longitude'>,
): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total path length of an order of points. */
function pathLength(points: readonly RoutePoint[], order: readonly number[]): number {
  let total = 0
  for (let index = 1; index < order.length; index += 1) {
    total += distanceKm(points[order[index - 1]!]!, points[order[index]!]!)
  }
  return total
}

/**
 * The order to drive `points` in, starting at `startId`.
 *
 * Ties are broken by the order the caller supplied, so the same day always produces the same round —
 * a plan that shuffles between page loads is one nobody trusts.
 */
export function planRoute(points: readonly RoutePoint[], startId?: string): RoutePlan {
  if (points.length === 0) return { ids: [], legs: [], totalKm: 0 }

  const startIndex = Math.max(
    0,
    points.findIndex((point) => point.id === startId),
  )
  if (points.length === 1) {
    return { ids: [points[0]!.id], legs: [0], totalKm: 0 }
  }

  // Nearest neighbour from the fixed start.
  const remaining = points.map((_, index) => index).filter((index) => index !== startIndex)
  const order = [startIndex]

  while (remaining.length > 0) {
    const from = points[order[order.length - 1]!]!
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = distanceKm(from, points[remaining[index]!]!)
      if (candidate < bestDistance) {
        bestDistance = candidate
        best = index
      }
    }
    order.push(remaining.splice(best, 1)[0]!)
  }

  // 2-opt: reverse a stretch of the path where that shortens it. The first point never moves, because
  // that is the visit whose slot the office already fixed. Repeat until a full sweep finds nothing.
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const before =
          distanceKm(points[order[i - 1]!]!, points[order[i]!]!) +
          (j + 1 < order.length ? distanceKm(points[order[j]!]!, points[order[j + 1]!]!) : 0)
        const after =
          distanceKm(points[order[i - 1]!]!, points[order[j]!]!) +
          (j + 1 < order.length ? distanceKm(points[order[i]!]!, points[order[j + 1]!]!) : 0)
        if (after < before - 1e-9) {
          const reversed = order.slice(i, j + 1).reverse()
          order.splice(i, reversed.length, ...reversed)
          improved = true
        }
      }
    }
  }

  const legs = order.map((index, position) =>
    position === 0 ? 0 : distanceKm(points[order[position - 1]!]!, points[index]!),
  )

  return {
    ids: order.map((index) => points[index]!.id),
    legs,
    totalKm: pathLength(points, order),
  }
}
