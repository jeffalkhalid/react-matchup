// components/ErrorBoundary.tsx — un écran qui plante ne doit pas emporter l'app.
//
// Sans filet, la moindre exception pendant le rendu laisse un ÉCRAN BLANC et
// l'app devient inutilisable (constaté le 2026-09-16 en ouvrant la fiche d'une
// partie). Pire : le message d'erreur reste invisible, donc impossible à
// rapporter.
//
// Ce composant attrape l'exception, garde le reste de l'app en vie, et AFFICHE
// le message — c'est lui qui dit quoi corriger.
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../lib/theme';

type Props = {
  children: React.ReactNode;
  /** Ce qu'on était en train d'ouvrir — apparaît dans le message. */
  quoi?: string;
  /** Proposé au joueur pour sortir (fermer la fiche, revenir en arrière…). */
  onClose?: () => void;
  /** L'écran protégé est un calque plein écran : le repli doit l'être aussi,
   *  sinon il se range en bas de l'écran parent, hors de vue. */
  modal?: boolean;
};

export class ErrorBoundary extends React.Component<Props, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // Visible dans les journaux de développement ; sans effet en production.
    console.error('[ErrorBoundary]', this.props.quoi ?? '', err?.message, info?.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    const corps = (
      <View style={{ flex: 1, backgroundColor: Colors.bg, padding: 20, justifyContent: 'center' }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 20, color: Colors.textPrimary, marginBottom: 8 }}>
          Cet écran n’a pas pu s’afficher
        </Text>
        <Text style={{ fontSize: 13, color: Colors.textMuted, marginBottom: 14 }}>
          {this.props.quoi ? `En ouvrant : ${this.props.quoi}.` : ''} Le reste de l’application continue de fonctionner.
        </Text>
        <ScrollView style={{ maxHeight: 220, backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 12 }}>
          <Text selectable style={{ fontSize: 12, color: Colors.textPrimary }}>
            {String(err?.message ?? err)}
          </Text>
        </ScrollView>
        {this.props.onClose ? (
          <TouchableOpacity
            onPress={() => { this.setState({ err: null }); this.props.onClose?.(); }}
            activeOpacity={0.85}
            style={{ marginTop: 16, backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontWeight: '900', color: Colors.textOnBrand }}>Fermer</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
    if (!this.props.modal) return corps;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}>
        {corps}
      </View>
    );
  }
}
