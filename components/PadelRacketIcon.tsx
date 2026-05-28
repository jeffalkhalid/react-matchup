import { Image, type ImageStyle, type StyleProp } from 'react-native';

type Props = {
  size?: number;
  style?: StyleProp<ImageStyle>;
};

export default function PadelRacketIcon({ size = 24, style }: Props) {
  return (
    <Image
      source={require('../assets/padel.png')}
      style={[{ width: size, height: size, resizeMode: 'contain' }, style]}
    />
  );
}
