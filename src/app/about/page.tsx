import TableOfContents from "@/components/about/TableOfContents";
import styles from "@/components/about/about.module.scss";
import { about, baseURL, person, social } from "@/resources";
import {
  Avatar,
  Button,
  Column,
  Heading,
  Icon,
  IconButton,
  Media,
  Meta,
  Row,
  Schema,
  Tag,
  Text,
} from "@once-ui-system/core";
import React from "react";

export async function generateMetadata() {
  return Meta.generate({
    title: about.title,
    description: about.description,
    baseURL: baseURL,
    image: `/api/og/generate?title=${encodeURIComponent(about.title)}`,
    path: about.path,
  });
}

export default function About() {
  const structure = [
    {
      title: about.intro.title,
      display: about.intro.display,
      items: [],
    },
    {
      title: about.work.title,
      display: about.work.display,
      items: about.work.experiences.map((experience) => experience.company),
    },
    {
      title: about.studies.title,
      display: about.studies.display,
      items: about.studies.institutions.map((institution) => institution.name),
    },
    {
      title: about.technical.title,
      display: about.technical.display,
      items: about.technical.skills.map((skill) => skill.title),
    },
  ];
  return (
    <Column maxWidth="m">
      <Schema
        as="webPage"
        baseURL={baseURL}
        title={about.title}
        description={about.description}
        path={about.path}
        image={`/api/og/generate?title=${encodeURIComponent(about.title)}`}
        author={{
          name: person.name,
          url: `${baseURL}${about.path}`,
          image: `${baseURL}${person.avatar}`,
        }}
      />
      {about.tableOfContent.display && <TableOfContents structure={structure} about={about} />}
      <Row fillWidth s={{ direction: "column" }} horizontal="center">
        {about.avatar.display && (
          <Column
            className={styles.avatar}
            top="64"
            fitHeight
            position="sticky"
            s={{ position: "relative", style: { top: "auto" } }}
            xs={{ style: { top: "auto" } }}
            minWidth="160"
            paddingX="l"
            paddingBottom="xl"
            gap="m"
            flex={3}
            horizontal="center"
          >
            <div data-swarm-piece="drag" style={{ display: "inline-flex" }}>
              <Avatar src={person.avatar} size="xl" />
            </div>
            <div data-swarm-piece="pop" style={{ display: "inline-flex" }}>
              <Row gap="8" vertical="center">
                <Icon onBackground="accent-weak" name="globe" />
                {person.location}
              </Row>
            </div>
            {person.languages && person.languages.length > 0 && (
              <Row wrap gap="8">
                {person.languages.map((language) => (
                  <div key={language} data-swarm-piece="pop" style={{ display: "inline-flex" }}>
                    <Tag size="l">{language}</Tag>
                  </div>
                ))}
              </Row>
            )}
          </Column>
        )}
        <Column className={styles.blockAlign} flex={9} maxWidth={40}>
          <Column
            id={about.intro.title}
            fillWidth
            minHeight="160"
            vertical="center"
            marginBottom="32"
          >
            {about.calendar.display && (
              <div data-swarm-piece="pop" style={{ display: "inline-flex" }}>
                <Row
                  fitWidth
                  border="brand-alpha-medium"
                  background="brand-alpha-weak"
                  radius="full"
                  padding="4"
                  gap="8"
                  marginBottom="m"
                  vertical="center"
                  className={styles.blockAlign}
                  style={{
                    backdropFilter: "blur(var(--static-space-1))",
                  }}
                >
                  <Icon paddingLeft="12" name="calendar" onBackground="brand-weak" />
                  <Row paddingX="8">Schedule a call</Row>
                  <IconButton
                    href={about.calendar.link}
                    data-border="rounded"
                    variant="secondary"
                    icon="chevronRight"
                  />
                </Row>
              </div>
            )}
            <div data-swarm-piece="type" className={styles.textAlign} style={{ width: "100%" }}>
              <Heading className={styles.textAlign} variant="display-strong-xl">
                {person.name}
              </Heading>
            </div>
            <div data-swarm-piece="type" className={styles.textAlign} style={{ width: "100%" }}>
              <Text
                className={styles.textAlign}
                variant="display-default-xs"
                onBackground="neutral-weak"
              >
                {person.role}
              </Text>
            </div>
            {social.length > 0 && (
              <div
                data-swarm-piece="pop"
                className={styles.blockAlign}
                style={{ display: "inline-flex" }}
              >
                <Row
                  className={styles.blockAlign}
                  paddingTop="20"
                  paddingBottom="8"
                  gap="8"
                  wrap
                  horizontal="center"
                  fitWidth
                  data-border="rounded"
                >
                  {social
                    .filter((item) => item.essential)
                    .map(
                      (item) =>
                        item.link && (
                          <React.Fragment key={item.name}>
                            <Row s={{ hide: true }}>
                              <Button
                                key={item.name}
                                href={item.link}
                                prefixIcon={item.icon}
                                label={item.name}
                                size="s"
                                weight="default"
                                variant="secondary"
                              />
                            </Row>
                            <Row hide s={{ hide: false }}>
                              <IconButton
                                size="l"
                                key={`${item.name}-icon`}
                                href={item.link}
                                icon={item.icon}
                                variant="secondary"
                              />
                            </Row>
                          </React.Fragment>
                        ),
                    )}
                </Row>
              </div>
            )}
          </Column>

          {about.intro.display && (
            <div data-swarm-piece="type" style={{ width: "100%" }}>
              <Column textVariant="body-default-l" fillWidth gap="m" marginBottom="xl">
                {about.intro.description}
              </Column>
            </div>
          )}

          {about.work.display && (
            <>
              <Heading as="h2" id={about.work.title} variant="display-strong-s" marginBottom="m">
                {about.work.title}
              </Heading>
              <Column fillWidth gap="l" marginBottom="40">
                {about.work.experiences.map((experience, index) => (
                  <div
                    key={`${experience.company}-${experience.role}-${index}`}
                    data-swarm-piece="draw"
                    style={{ width: "100%" }}
                  >
                    <Column fillWidth>
                      <Row fillWidth horizontal="between" vertical="end" marginBottom="4">
                        <Text id={experience.company} variant="heading-strong-l">
                          {experience.company}
                        </Text>
                        <Text variant="heading-default-xs" onBackground="neutral-weak">
                          {experience.timeframe}
                        </Text>
                      </Row>
                      <Text variant="body-default-s" onBackground="brand-weak" marginBottom="m">
                        {experience.role}
                      </Text>
                      <Column as="ul" gap="16">
                        {experience.achievements.map(
                          (achievement: React.ReactNode, index: number) => (
                            <Text
                              as="li"
                              variant="body-default-m"
                              key={`${experience.company}-${index}`}
                            >
                              {achievement}
                            </Text>
                          ),
                        )}
                      </Column>
                      {experience.images && experience.images.length > 0 && (
                        <Row fillWidth paddingTop="m" paddingLeft="40" gap="12" wrap>
                          {experience.images.map((image) => (
                            <Row
                              key={image.src}
                              border="neutral-medium"
                              radius="m"
                              minWidth={image.width}
                              height={image.height}
                            >
                              <Media
                                enlarge
                                radius="m"
                                sizes={image.width.toString()}
                                alt={image.alt}
                                src={image.src}
                              />
                            </Row>
                          ))}
                        </Row>
                      )}
                    </Column>
                  </div>
                ))}
              </Column>
            </>
          )}

          {about.studies.display && (
            <>
              <Heading as="h2" id={about.studies.title} variant="display-strong-s" marginBottom="m">
                {about.studies.title}
              </Heading>
              <Column fillWidth gap="l" marginBottom="40">
                {about.studies.institutions.map((institution, index) => (
                  <div
                    key={`${institution.name}-${index}`}
                    data-swarm-piece="draw"
                    style={{ width: "100%" }}
                  >
                    <Column fillWidth gap="4">
                      <Text id={institution.name} variant="heading-strong-l">
                        {institution.name}
                      </Text>
                      <Text variant="heading-default-xs" onBackground="neutral-weak">
                        {institution.description}
                      </Text>
                    </Column>
                  </div>
                ))}
              </Column>
            </>
          )}

          {about.technical.display && (
            <>
              <Heading
                as="h2"
                id={about.technical.title}
                variant="display-strong-s"
                marginBottom="40"
              >
                {about.technical.title}
              </Heading>
              <Column fillWidth gap="l">
                {about.technical.skills.map((skill, index) => (
                  <div key={`${skill.title}-${index}`} style={{ width: "100%" }}>
                    <Column fillWidth gap="4">
                      <div data-swarm-piece="type" style={{ width: "100%" }}>
                        <Text id={skill.title} variant="heading-strong-l">
                          {skill.title}
                        </Text>
                      </div>
                      <div data-swarm-piece="type" style={{ width: "100%" }}>
                        <Text variant="body-default-m" onBackground="neutral-weak">
                          {skill.description}
                        </Text>
                      </div>
                      {skill.tags && skill.tags.length > 0 && (
                        <Row wrap gap="8" paddingTop="8">
                          {skill.tags.map((tag, tagIndex) => (
                            <div
                              key={`${skill.title}-${tagIndex}`}
                              data-swarm-piece="drag"
                              style={{ display: "inline-flex" }}
                            >
                              <Tag size="l" prefixIcon={tag.icon}>
                                {tag.name}
                              </Tag>
                            </div>
                          ))}
                        </Row>
                      )}
                      {skill.images && skill.images.length > 0 && (
                        <Row fillWidth paddingTop="m" gap="12" wrap>
                          {skill.images.map((image) => (
                            <Row
                              key={image.src}
                              border="neutral-medium"
                              radius="m"
                              minWidth={image.width}
                              height={image.height}
                            >
                              <Media
                                enlarge
                                radius="m"
                                sizes={image.width.toString()}
                                alt={image.alt}
                                src={image.src}
                              />
                            </Row>
                          ))}
                        </Row>
                      )}
                    </Column>
                  </div>
                ))}
              </Column>
            </>
          )}
        </Column>
      </Row>
    </Column>
  );
}
