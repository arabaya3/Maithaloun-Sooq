import {
  InfoPage,
  infoPageMetadata,
} from "@/features/storefront/components/info-page";

// Unknown languages (scanner paths like /wp-login.php land here) are a static 404, never a render.
export const dynamicParams = false;

export const generateMetadata = () => infoPageMetadata("about");

export default function Page() {
  return <InfoPage pageKey="about" />;
}
