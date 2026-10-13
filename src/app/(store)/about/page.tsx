import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

export const generateMetadata = () => infoPageMetadata("about");

export default function Page() {
  return <InfoPage pageKey="about" />;
}
