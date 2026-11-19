import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:get_storage/get_storage.dart';
import 'package:go_router/go_router.dart';

import 'core/theme.dart';
import 'data/catalog_repository.dart';
import 'domain/entities/catalog_item.dart';
import 'features/browse/browse_page.dart';
import 'features/catalog/catalog_cubit.dart';
import 'features/catalog/content_details_page.dart';
import 'features/player/player_page.dart';
import 'features/search/section_search_page.dart';
import 'features/shell/app_shell.dart';
import 'features/shorts/shorts_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await GetStorage.init();
  // API_BASE_URL and APP_API_KEY (see .env.example). Optional so a build without
  // the file still starts against the local development API.
  await dotenv.load(fileName: '.env', isOptional: true);
  final repository = CatalogRepository();
  runApp(BlocProvider(
      create: (_) => CatalogCubit(repository)..load(), child: const NexoApp()));
}

class NexoApp extends StatefulWidget {
  const NexoApp({super.key});
  @override
  State<NexoApp> createState() => _NexoAppState();
}

class _NexoAppState extends State<NexoApp> {
  // Built once so navigation state survives rebuilds and hot reload.
  final _router = GoRouter(initialLocation: '/', routes: [
    GoRoute(path: '/', builder: (context, state) => const AppShell()),
    GoRoute(
        path: '/browse',
        builder: (context, state) {
          final target = state.extra;
          return BrowsePage(
              target: target is BrowseTarget
                  ? target
                  : const BrowseTarget(kind: 'movies', title: 'Movies'));
        }),
    GoRoute(
        path: '/movie/:slug',
        builder: (context, state) =>
            MovieDetailsPage(slug: state.pathParameters['slug']!)),
    GoRoute(
        path: '/series/:slug',
        builder: (context, state) =>
            SeriesDetailsPage(slug: state.pathParameters['slug']!)),
    GoRoute(
        path: '/player/:id',
        builder: (context, state) => PlayerPage(
            // A new channel must get a fresh player, not reuse this state.
            key: ValueKey(state.uri.toString()),
            id: state.pathParameters['id']!,
            name: state.uri.queryParameters['name'] ?? 'Now playing',
            url: state.uri.queryParameters['url'],
            type: state.uri.queryParameters['type'] ?? 'channel',
            playbackKind: state.uri.queryParameters['playbackKind'] ?? 'hls',
            category: state.uri.queryParameters['category'] ?? '',
            playbackServers:
                _parsePlaybackServers(state.uri.queryParameters['servers']),
            trailerUrl: state.uri.queryParameters['trailer'],
            startFullscreen: state.uri.queryParameters['fullscreen'] == '1')),
    GoRoute(
        path: '/search',
        builder: (context, state) =>
            SectionSearchPage(section: state.uri.queryParameters['section'])),
    GoRoute(
        path: '/shorts',
        builder: (context, state) {
          final args = state.extra;
          return ShortsPage(
              args: args is ShortsArgs
                  ? args
                  : const ShortsArgs(items: <CatalogItem>[]));
        }),
  ]);

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  static List<PlaybackServer> _parsePlaybackServers(String? raw) {
    if (raw == null || raw.isEmpty) return const [];
    try {
      final values = jsonDecode(raw);
      if (values is! List) return const [];
      return values
          .whereType<Map<dynamic, dynamic>>()
          .map((item) =>
              PlaybackServer.fromJson(Map<String, dynamic>.from(item)))
          .whereType<PlaybackServer>()
          .toList();
    } catch (_) {
      return const [];
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
      title: 'NEXO',
      debugShowCheckedModeBanner: false,
      theme: nexoTheme(),
      // Follow the system font size, but stop before layouts break.
      builder: (context, child) => MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.3, child: child ?? const SizedBox.shrink()),
      routerConfig: _router);
}
