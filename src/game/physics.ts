/**
 * Power → speed for a road bike. The Peloton can't change resistance for us, so hills
 * are simulated here: on a climb the same watts give less speed, and descents are free speed.
 */
export const RIDER = {
  /** Default rider + bike, kg (bots, and riders without a profile weight) */
  massKg: 85,
  /** Added to a profile's body weight */
  bikeKg: 9,
  /** Drag area, m² (hoods position) */
  cda: 0.32,
  /** Rolling resistance coefficient */
  crr: 0.005,
  /** Air density, kg/m³ */
  rho: 1.225,
  drivetrainEfficiency: 0.97
};

const G = 9.81;
/** Below this speed P/v blows up; treat it as the floor when computing propulsive force. */
const MIN_PROPULSION_SPEED = 1;

/**
 * Advances speed (m/s) by dt seconds given rider power (W) and grade (rise/run, 0.05 = 5%).
 * `dragFactor` scales aerodynamic drag, e.g. 0.7 when sitting in another rider's draft.
 * `massKg` is rider + bike, so a lighter rider climbs faster for the same watts.
 */
export const stepSpeed = (
  speed: number,
  power: number,
  grade: number,
  dt: number,
  dragFactor = 1,
  massKg = RIDER.massKg
) => {
  const theta = Math.atan(grade);
  const { cda, crr, rho, drivetrainEfficiency } = RIDER;

  const propulsion = (power * drivetrainEfficiency) / Math.max(speed, MIN_PROPULSION_SPEED);
  const gravity = massKg * G * Math.sin(theta);
  const rolling = speed > 0 || propulsion > 0 ? massKg * G * crr * Math.cos(theta) : 0;
  const drag = 0.5 * rho * cda * dragFactor * speed * speed;

  const acceleration = (propulsion - gravity - rolling - drag) / massKg;
  // No rolling backwards on climbs.
  return Math.max(0, speed + acceleration * dt);
};
