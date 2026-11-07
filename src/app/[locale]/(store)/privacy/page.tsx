import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

export const generateMetadata = () => infoPageMetadata("privacy");

export default function Page() {
  return <InfoPage pageKey="privacy" />;
}
