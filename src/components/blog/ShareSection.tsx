"use client";

import { socialSharing } from "@/resources";
import { Button, Row, Text, useToast } from "@once-ui-system/core";
import { useState } from "react";

interface ShareSectionProps {
  title: string;
  url: string;
}

interface SocialPlatform {
  name: string;
  icon: string;
  label: string;
  generateUrl: (title: string, url: string) => string;
}

const socialPlatforms: Record<string, SocialPlatform> = {
  x: {
    name: "x",
    icon: "twitter",
    label: "X",
    generateUrl: (title, url) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
  },
  linkedin: {
    name: "linkedin",
    icon: "linkedin",
    label: "LinkedIn",
    generateUrl: (_title, url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  facebook: {
    name: "facebook",
    icon: "facebook",
    label: "Facebook",
    generateUrl: (_title, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  pinterest: {
    name: "pinterest",
    icon: "pinterest",
    label: "Pinterest",
    generateUrl: (title, url) =>
      `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}`,
  },
  whatsapp: {
    name: "whatsapp",
    icon: "whatsapp",
    label: "WhatsApp",
    generateUrl: (title, url) => `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  reddit: {
    name: "reddit",
    icon: "reddit",
    label: "Reddit",
    generateUrl: (title, url) =>
      `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  },
  telegram: {
    name: "telegram",
    icon: "telegram",
    label: "Telegram",
    generateUrl: (title, url) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  email: {
    name: "email",
    icon: "email",
    label: "Email",
    generateUrl: (title, url) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Check out this post: ${url}`)}`,
  },
};

export function ShareSection({ title, url }: ShareSectionProps) {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!socialSharing.display) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      addToast({
        variant: "success",
        message: "Link copied to clipboard",
      });
    } catch {
      addToast({
        variant: "danger",
        message: "Failed to copy link",
      });
    }
  };

  const enabledPlatforms = Object.entries(socialSharing.platforms)
    .filter(([key, enabled]) => enabled && key !== "copyLink")
    .map(([platformKey]) => ({ key: platformKey, ...socialPlatforms[platformKey] }))
    .filter((platform) => platform.name);

  return (
    <Row fillWidth center gap="16" marginTop="32" marginBottom="16" wrap>
      <Text variant="label-default-m" onBackground="neutral-weak">
        Share this post:
      </Text>
      <Row data-border="rounded" gap="12" horizontal="center" wrap>
        {enabledPlatforms.map((platform) => (
          <Button
            key={platform.key}
            variant="secondary"
            size="s"
            href={platform.generateUrl(title, url)}
            prefixIcon={platform.icon}
            aria-label={`Share on ${platform.label}`}
            title={`Share on ${platform.label}`}
          />
        ))}

        {socialSharing.platforms.copyLink && (
          <Button
            variant="secondary"
            size="s"
            onClick={handleCopy}
            prefixIcon={copied ? "check" : "openLink"}
            label={copied ? "Copied" : undefined}
            aria-label="Copy post link"
            title="Copy post link"
          />
        )}
      </Row>
    </Row>
  );
}
