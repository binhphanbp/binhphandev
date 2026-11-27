"use client";

import type React from "react";
import { useSwarm } from "./SwarmProvider";
import styles from "./SwarmStudio.module.scss";

export const SwarmFinale: React.FC = () => {
  const { mode, replayBuild, viewFinalDesign } = useSwarm();

  return (
    <section
      id="swarm-finale-anchor"
      className={styles.finaleSection}
      aria-label="Portfolio build finale"
    >
      <div className={styles.finaleCard}>
        <span data-swarm-piece="pop" className={styles.finaleEyebrow}>
          That&apos;s a wrap
        </span>
        <h2 data-swarm-piece="type" className={styles.finaleTitle}>
          Thanks for scrolling.
        </h2>
        <div className={styles.finaleActions}>
          <button
            type="button"
            data-swarm-piece="pop"
            onClick={replayBuild}
            className={styles.finaleBtnSecondary}
          >
            <span>Replay the build</span>
            <span aria-hidden="true">↻</span>
          </button>
          {mode !== "present" && (
            <button
              type="button"
              data-swarm-piece="pop"
              onClick={viewFinalDesign}
              className={styles.finaleBtnPrimary}
            >
              <span>View final design</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
