import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

export const generateMetadata = () => infoPageMetadata("delivery");

export default function Page() {
  return <InfoPage pageKey="delivery" />;
}
