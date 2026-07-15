export const IOS_MOTION = {
  duration: {
    press: 160,
    control: 220,
    content: 280,
    modal: 300,
    navigationEnter: 360,
    navigationExit: 300,
    drawer: 360,
    rail: 350,
    toast: 300,
  },
  curve: {
    standard: [0.25, 0.1, 0.25, 1] as const,
    decelerate: [0, 0, 0.58, 1] as const,
    navigation: [0.32, 0.72, 0, 1] as const,
  },
  spring: {
    damping: 28,
    mass: 1,
    stiffness: 300,
  },
} as const;
