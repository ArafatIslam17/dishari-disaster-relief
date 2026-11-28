import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { formatNumber } from '../i18n';

/**
 * Dishari motion helpers. The motion language itself (tokens, verbs, choreography) lives in
 * styles/motion.css; these hooks cover the few things CSS cannot do alone. Rules they all keep:
 * - the resting state is always the real, readable state (nothing waits on an animation to show data);
 * - only transform and opacity move, and nothing re-renders React per frame;
 * - prefers-reduced-motion gets the final state at once;
 * - every observer, frame and timer is released on unmount.
 */

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Summary figure that counts up once, the first time it scrolls into view. Later changes (a filter,
 * a reload) show the new value at once, so live figures never animate while someone is reading them.
 * While counting, screen readers get the final value; the rolling digits are hidden from them.
 */
export function CountUp({ value, format = formatNumber, duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [phase, setPhase] = useState<'count' | 'done'>(() => (value > 0 && !reducedMotion() && typeof IntersectionObserver !== 'undefined' ? 'count' : 'done'));
  const ref = useRef<HTMLSpanElement>(null);
  const start = useRef(value);
  const fmt = useRef(format);
  fmt.current = format;

  // New data while counting: stop and show it.
  useEffect(() => {
    if (value !== start.current) setPhase('done');
  }, [value]);

  useLayoutEffect(() => {
    if (phase !== 'count') return;
    const el = ref.current;
    if (!el) return;
    el.textContent = fmt.current(0);
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        el.textContent = fmt.current(Math.round(start.current * easeOutCubic(p)));
        if (p < 1) raf = requestAnimationFrame(tick);
        else setPhase('done');
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [phase, duration]);

  if (phase === 'done') return <>{format(value)}</>;
  return (
    <>
      {/* React never renders children here; the frame loop owns this text node until it finishes. */}
      <span ref={ref} aria-hidden="true" className="count-up" />
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}

/**
 * Shared-layout indicator: one element that slides to whichever item is current (the sidebar's active
 * link, the field bar's active pill). Writes --ind-x/y/w/h on the container; the first placement and
 * any resize snap without a transition, only real navigation slides.
 */
export function useActiveIndicator(container: RefObject<HTMLElement | null>, target: string, deps: unknown[]) {
  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return;
    let raf = 0;
    const place = (slide: boolean) => {
      const el = box.querySelector<HTMLElement>(target);
      if (!el || el.getClientRects().length === 0) {
        box.dataset.indicator = 'none';
        return;
      }
      const a = box.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      box.style.setProperty('--ind-x', `${b.left - a.left}px`);
      box.style.setProperty('--ind-y', `${b.top - a.top}px`);
      box.style.setProperty('--ind-w', `${b.width}px`);
      box.style.setProperty('--ind-h', `${b.height}px`);
      if (slide && box.dataset.indicator === 'on') return;
      // Snap into place this frame, allow sliding from the next one.
      box.dataset.indicator = 'still';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (box.dataset.indicator === 'still') box.dataset.indicator = 'on';
        });
      });
    };
    place(true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place(false)) : null;
    ro?.observe(box);
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass explicit dependencies
  }, deps);
}

const REVEAL = '.card, .panel, .table-wrap, .empty, .hh-card, .menu-list, .fieldset, .consent, .summary, .receipt, .history-list';

/**
 * Scroll reveal for blocks that arrive below the fold: they wait, then rise once when scrolled to.
 * Blocks already on screen keep the page entrance instead. Classes are added before the browser paints
 * (MutationObserver), and removed after the reveal so hover transforms and printing are untouched.
 */
export function useScrollReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = root.current;
    if (!main || reducedMotion() || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          el.classList.add('is-revealed');
          const id = setTimeout(() => {
            timers.delete(id);
            el.classList.remove('reveal', 'is-revealed');
          }, 900);
          timers.add(id);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0 },
    );
    const consider = (el: Element) => {
      // Only the outermost block of a group moves, so nested cards never animate twice.
      const outer = el.parentElement?.closest(REVEAL);
      if (outer && main.contains(outer)) return;
      if (el.getBoundingClientRect().top <= window.innerHeight) return;
      el.classList.add('reveal');
      io.observe(el);
    };
    const scan = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(REVEAL)) consider(node);
      else node.querySelectorAll(REVEAL).forEach(consider);
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach(scan);
    });
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
      timers.forEach(clearTimeout);
      main.querySelectorAll('.reveal').forEach((el) => el.classList.remove('reveal', 'is-revealed'));
    };
  }, [root]);
}

/**
 * Keeps a closing element mounted for its exit animation, then removes it. Interaction never waits:
 * the caller marks the closing element inert, and reduced motion removes it at once.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const id = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}
