import { Composition } from "remotion";
import { DevCatDemo, FPS, totalFrames } from "./DevCatDemo";

export const Root = () => (
  <Composition id="DevCatDemo" component={DevCatDemo} durationInFrames={totalFrames()} fps={FPS} width={1280} height={800} />
);
