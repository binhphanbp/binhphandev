"use client";

import { Column, Flex, Text } from "@once-ui-system/core";
import type React from "react";
import styles from "./about.module.scss";

interface TableOfContentsProps {
  structure: {
    title: string;
    display: boolean;
    items: string[];
  }[];
  about: {
    tableOfContent: {
      display: boolean;
      subItems: boolean;
    };
  };
}

const TableOfContents: React.FC<TableOfContentsProps> = ({ structure, about }) => {
  const scrollTo = (id: string, offset: number) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("swarm:pause-autoscroll"));
    }
    const element = document.getElementById(id);
    if (element) {
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  };

  if (!about.tableOfContent.display) return null;

  return (
    <Column
      as="nav"
      aria-label="About sections"
      left="0"
      className={styles.tocFixed}
      style={{
        top: "50%",
        transform: "translateY(-50%)",
        whiteSpace: "nowrap",
      }}
      position="fixed"
      paddingLeft="24"
      gap="32"
    >
      {structure
        .filter((section) => section.display)
        .map((section) => (
          <Column key={section.title} gap="12">
            <button
              type="button"
              data-toc-jump="true"
              className={styles.tocBtn}
              onClick={() => scrollTo(section.title, 88)}
            >
              <Flex height="1" minWidth="16" background="neutral-strong" />
              <Text variant="body-default-s">{section.title}</Text>
            </button>
            {about.tableOfContent.subItems &&
              section.items.map((item) => (
                <button
                  type="button"
                  data-toc-jump="true"
                  key={item}
                  className={styles.tocBtn}
                  style={{ paddingLeft: "24px" }}
                  onClick={() => scrollTo(item, 88)}
                >
                  <Flex height="1" minWidth="8" background="neutral-strong" />
                  <Text variant="body-default-xs">{item}</Text>
                </button>
              ))}
          </Column>
        ))}
    </Column>
  );
};

export default TableOfContents;
