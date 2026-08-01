'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Shared motion vocabulary (ui-ux-pro-max: 200–300ms, never block
 * navigation, honor reduced motion). Enter-only — route exits are instant.
 */

export function PageTransition({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      // Reduced motion means *no* transition, not a shorter one: fading from
      // transparent is still movement to a vestibular-sensitive user.
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/** Container that staggers its <FadeInItem> children ~60ms apart. */
export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      // A stagger is a sequence of movements; with reduced motion the whole
      // list should simply be present.
      transition={{ staggerChildren: reduce ? 0 : 0.06 }}
    >
      {children}
    </motion.div>
  );
}

export function FadeInItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 14, scale: 0.98 },
        show: { opacity: 1, y: 0, scale: 1 },
      }}
      transition={reduce ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
