import { describe, expect, it } from 'vitest'
import { distanceKm, planRoute, type RoutePoint } from '@/server/schedule/routes'

/**
 * Route optimisation (slice 35), without a database.
 *
 * What these pin: the distance is a real great-circle measurement, the round starts where the office
 * said it starts, and the order it returns is never worse than the order it was given — a plan that
 * only claims to be shorter would be worse than none.
 */

const SINGAPORE = { latitude: 1.2644, longitude: 103.8223 }

function point(id: string, latitude: number, longitude: number): RoutePoint {
  return { id, latitude, longitude }
}

describe('distanceKm', () => {
  it('is zero between a point and itself', () => {
    expect(distanceKm(SINGAPORE, SINGAPORE)).toBe(0)
  })

  it('measures a known pair to within a kilometre', () => {
    // Jurong Pier (619195) to Changi Airport (819643) is about 38 km in a straight line.
    const jurong = point('a', 1.3119, 103.7086)
    const changi = point('b', 1.3574, 103.9876)
    expect(distanceKm(jurong, changi)).toBeGreaterThan(30)
    expect(distanceKm(jurong, changi)).toBeLessThan(40)
  })

  it('is symmetric', () => {
    const a = point('a', 1.3, 103.7)
    const b = point('b', 1.36, 103.99)
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9)
  })
})

describe('planRoute', () => {
  it('returns nothing for no points', () => {
    expect(planRoute([])).toEqual({ ids: [], legs: [], totalKm: 0 })
  })

  it('returns the single point, with no distance to travel', () => {
    expect(planRoute([point('only', 1.3, 103.7)])).toEqual({
      ids: ['only'],
      legs: [0],
      totalKm: 0,
    })
  })

  it('starts at the point the caller named, not the nearest to anything', () => {
    // 'first' is deliberately the far end of the cluster: it is the visit whose slot was fixed.
    const plan = planRoute(
      [point('first', 1.4, 104.0), point('middle', 1.31, 103.71), point('near', 1.32, 103.72)],
      'first',
    )
    expect(plan.ids[0]).toBe('first')
    expect(plan.ids).toHaveLength(3)
    // From the far end, the two neighbours are visited in the order that does not double back.
    expect(plan.ids.slice(1)).toEqual(['near', 'middle'])
  })

  it('never returns a longer path than the order it was given', () => {
    const points = [
      point('a', 1.31, 103.71),
      point('b', 1.36, 103.99),
      point('c', 1.315, 103.715),
      point('d', 1.33, 103.8),
      point('e', 1.358, 103.98),
    ]
    const given = distanceKm(points[0]!, points[1]!) +
      distanceKm(points[1]!, points[2]!) +
      distanceKm(points[2]!, points[3]!) +
      distanceKm(points[3]!, points[4]!)
    const plan = planRoute(points, 'a')
    expect(plan.totalKm).toBeLessThanOrEqual(given + 1e-9)
  })

  it('breaks out the same total it reports as legs', () => {
    const points = [point('a', 1.31, 103.71), point('b', 1.36, 103.99), point('c', 1.315, 103.715)]
    const plan = planRoute(points, 'a')
    const summed = plan.legs.reduce((total, leg) => total + leg, 0)
    expect(summed).toBeCloseTo(plan.totalKm, 9)
    expect(plan.legs[0]).toBe(0)
  })

  it('is deterministic: the same day plans the same round twice', () => {
    const points = [point('a', 1.31, 103.71), point('b', 1.36, 103.99), point('c', 1.315, 103.715)]
    expect(planRoute(points, 'a')).toEqual(planRoute(points, 'a'))
  })
})
