"use client";

import { Badge, Button, Column, Heading, Line, Row, Text } from "@once-ui-system/core";
import type React from "react";
import { useSwarm } from "./SwarmProvider";
import styles from "./SwarmStudio.module.scss";

export const SwarmFinale: React.FC = () => {
  const { mode, replayBuild, viewFinalDesign } = useSwarm();

  return (
    <section
      id="swarm-finale-anchor"
      data-swarm-section="finale"
      className={styles.finaleSection}
      aria-label="Portfolio build finale"
    >
      <Column maxWidth="s" fillWidth horizontal="center" align="center" gap="16">
        <div
          data-swarm-piece="line"
          style={{ width: "100%", display: "flex", justifyContent: "center" }}
        >
          <Line maxWidth={48} />
        </div>

        <div data-swarm-piece="pop" style={{ display: "inline-flex", marginTop: "8px" }}>
          <Badge
            background="brand-alpha-weak"
            border="brand-alpha-medium"
            paddingX="12"
            paddingY="4"
            onBackground="brand-weak"
            textVariant="label-default-s"
            arrow={false}
          >
            That&apos;s a wrap
          </Badge>
        </div>

        <div data-swarm-piece="type" style={{ width: "100%" }}>
          <Heading as="h2" variant="display-strong-m" wrap="balance" align="center">
            Thanks for scrolling.
          </Heading>
        </div>

        <div data-swarm-piece="type" style={{ width: "100%" }}>
          <Text variant="body-default-m" onBackground="neutral-weak" wrap="balance" align="center">
            Built live piece-by-piece — replay the choreography anytime or explore cleanly.
          </Text>
        </div>

        <Row
          gap="12"
          paddingTop="8"
          wrap
          horizontal="center"
          vertical="center"
          data-border="rounded"
        >
          <div data-swarm-piece="pop" style={{ display: "inline-flex" }}>
            <Button
              variant="secondary"
              size="m"
              weight="default"
              prefixIcon="refresh"
              onClick={replayBuild}
            >
              Replay the build
            </Button>
          </div>

          {mode !== "present" && (
            <div data-swarm-piece="fill" style={{ display: "inline-flex" }}>
              <Button
                variant="primary"
                size="m"
                weight="default"
                suffixIcon="arrowRight"
                onClick={viewFinalDesign}
              >
                View final design
              </Button>
            </div>
          )}
        </Row>
      </Column>
    </section>
  );
};
