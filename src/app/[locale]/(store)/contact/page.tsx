import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

export const generateMetadata = () => infoPageMetadata("contact");

export default function Page() {
  return <InfoPage pageKey="contact" />;
}
