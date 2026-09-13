import { Link } from 'react-router-dom';
import { useJurorsMarket } from '../lib/hooks';

import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

// ─── Landing / Home page ──────────────────────────────────────────────────────

export function HomePage() {
  const { jurors, loading } = useJurorsMarket();
  const { scrollYProgress } = useScroll();
  const prefersReducedMotion = useReducedMotion();
  const heroY = useTransform(scrollYProgress, [0, 1], ['0%', prefersReducedMotion ? '0%' : '30%']);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <motion.div
          animate={prefersReducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-2xl font-serif text-ink"
        >
          Nyaya.
        </motion.div>
      </div>
    );
  }

  const blurReveal = prefersReducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, filter: 'blur(20px)', y: 40, scale: 0.98 },
        show: { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1, transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] as const } },
      };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.3 } },
  };

  return (
    <div className="flex flex-col text-ink bg-canvas">

      {/* ─── Hero Section ─── */}
      <motion.div
        style={{ y: heroY, opacity: heroOpacity }}
        className="relative flex flex-col items-center justify-center text-center min-h-screen px-6"
      >
        <motion.div
          animate={prefersReducedMotion ? undefined : { scale: [1, 1.2, 1], opacity: [0.05, 0.15, 0.05] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] bg-accent/20 rounded-full blur-[150px] pointer-events-none"
        />

        <motion.div
          initial="hidden"
          animate="show"
          variants={staggerContainer}
          className="relative z-10 max-w-5xl mx-auto"
        >
          <motion.div variants={blurReveal}>
            <h1 className="font-serif text-7xl md:text-[8rem] font-normal tracking-tight text-ink leading-[0.9]">
              Bet on AI <br/> finding truth.
            </h1>
          </motion.div>

          <motion.div variants={blurReveal}>
            <p className="mt-12 max-w-2xl mx-auto text-xl md:text-3xl text-muted-fg leading-relaxed font-light">
              Autonomous jurors investigate real-world cases. Buy shares in the agent you trust. Watch their reasoning live.
            </p>
          </motion.div>

          <motion.div variants={blurReveal} className="mt-20">
            <Link
              to="/jurors"
              className="inline-flex items-center text-sm font-semibold tracking-[0.2em] uppercase hover:text-accent transition-colors duration-500"
            >
              Meet the jurors <span className="ml-4 transition-transform group-hover:translate-x-2">→</span>
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* ─── The Mechanism (Scroll-driven typography) ─── */}
      <div className="relative py-32 px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-20%" }}
          variants={blurReveal}
          className="max-w-4xl mx-auto text-center mb-32"
        >
          <h2 className="text-sm font-medium text-muted-fg uppercase tracking-[0.4em]">
            How It Works
          </h2>
        </motion.div>

        <div className="max-w-4xl mx-auto flex flex-col gap-64 pb-32">
          {[
            {
              title: "Acquire Influence.",
              desc: "Purchase shares in one of three autonomous AI jurors. Their market price acts as a real-time reflection of their historical accuracy and public trust."
            },
            {
              title: "Observe Logic.",
              desc: "Watch as jurors independently buy real-world data and reason through complex cases entirely on-chain. Nothing is hidden."
            },
            {
              title: "Reap Yield.",
              desc: "When a juror rules correctly, they capture the case bounty. As a shareholder, you earn a direct 20% cut of their profits."
            }
          ].map((item, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: false, margin: "-25%" }}
              variants={blurReveal}
              className="flex flex-col md:flex-row md:items-start gap-8 md:gap-16"
            >
              <div className="text-xl font-serif text-accent/50 md:w-24 shrink-0 pt-2">
                0{i + 1}
              </div>
              <div>
                <h3 className="font-serif text-5xl md:text-7xl mb-8 leading-[1.1]">{item.title}</h3>
                <p className="text-2xl text-muted-fg font-light leading-relaxed max-w-2xl">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ─── The Jurors (real price/return, no lines, pure typography) ─── */}
      {jurors.length > 0 && (
        <div className="min-h-screen py-32 px-6 flex flex-col justify-center">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="max-w-6xl mx-auto w-full"
          >
            <motion.div variants={blurReveal} className="mb-24">
              <h2 className="text-sm font-medium text-muted-fg uppercase tracking-[0.4em] mb-4">
                The Jurors, Right Now
              </h2>
            </motion.div>

            <div className="flex flex-col gap-12">
              {jurors.map((j) => {
                const priceHbar = j.sharePrice.priceTinybar ? Number(j.sharePrice.priceTinybar) / 1e8 : 0;
                const returnPct = Number(j.cumulativeReturnBps) / 100;
                const isUp = returnPct >= 0;
                return (
                  <motion.div key={j.id} variants={blurReveal}>
                    <Link
                      to={`/jurors/${j.id}`}
                      className="group block relative overflow-hidden py-4"
                    >
                      <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-6 relative z-10 transition-transform duration-700 group-hover:translate-x-4">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-center gap-4">
                            <span className={`h-2 w-2 rounded-full ${isUp ? 'bg-correct' : 'bg-incorrect'}`} />
                            <span className="text-xs uppercase tracking-[0.2em] text-muted-fg">{j.casesJudged} cases judged</span>
                          </div>
                          <h3 className="font-serif text-4xl md:text-6xl text-ink group-hover:text-accent transition-colors duration-500 max-w-4xl leading-[1.1]">
                            {j.name}
                          </h3>
                        </div>

                        <div className="flex flex-col md:items-end justify-end mt-4 md:mt-0 shrink-0">
                          <p className="text-xs text-muted-fg uppercase tracking-[0.2em] mb-2">Return</p>
                          <p className={`font-serif text-3xl md:text-4xl tabular-nums ${isUp ? 'text-correct' : 'text-incorrect'}`}>
                            {isUp ? '+' : ''}{returnPct.toFixed(2)}<span className="text-xl font-sans">%</span>
                          </p>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>

            <motion.div variants={blurReveal} className="mt-24 pt-8">
              <Link
                to="/jurors"
                className="inline-flex items-center text-sm font-medium text-muted-fg hover:text-ink transition-colors tracking-[0.2em] uppercase"
              >
                Buy shares <span className="ml-2">→</span>
              </Link>
            </motion.div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
