import { Button, Column, Heading, Row, Text } from "@once-ui-system/core";

export default function NotFound() {
  return (
    <Column as="section" data-not-found-page="true" fill center gap="12" paddingY="80">
      <Text variant="display-strong-xl">404</Text>
      <Heading as="h1" variant="display-default-xs">
        Page Not Found
      </Heading>
      <Text onBackground="neutral-weak" marginBottom="16" align="center">
        The page you are looking for does not exist or has been moved.
      </Text>
      <Row data-border="rounded">
        <Button href="/" variant="secondary" size="m" weight="default" arrowIcon>
          Back to Home
        </Button>
      </Row>
    </Column>
  );
}
