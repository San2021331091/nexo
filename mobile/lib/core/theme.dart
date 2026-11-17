import 'package:flutter/material.dart';

const kPink = Color(0xFFFF2E86);
const kBg = Color(0xFF111114);
const kPanel = Color(0xFF1C1B22);
const kNavBar = Color(0xFF17161C);
const kMuted = Color(0xFFA9A6B2);

/// The purple-to-navy wash behind Live TV, Discover and My List.
const kPageGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF341449), Color(0xFF1B1433), Color(0xFF11112A)]);

ThemeData nexoTheme() => ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: kBg,
      colorScheme: ColorScheme.fromSeed(
          seedColor: kPink,
          brightness: Brightness.dark,
          primary: kPink,
          surface: kPanel),
      appBarTheme: const AppBarTheme(
          backgroundColor: kBg, surfaceTintColor: Colors.transparent),
      useMaterial3: true,
      fontFamily: 'Roboto',
    );
