import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

export const generateMetadata = () => infoPageMetadata("terms");

export default function Page() {
  return <InfoPage pageKey="terms" />;
}
