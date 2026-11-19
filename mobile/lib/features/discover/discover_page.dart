import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../live/live_page.dart';
import '../shared/widgets.dart';

const _genres = [
  'Drama',
  'Crime',
  'Action',
  'Thriller',
  'Romance',
  'Comedy',
  'Horror',
  'Animation',
  'Family',
  'Documentary',
];

/// The Discover groups, in the order they are shown.
const discoverSections = [
  'Live Channels',
  'Sports',
  'Movies',
  'Web Series',
  'Dramas',
];

// Original languages whose TV series NEXO files under Dramas (K-dramas,
// Turkish, Chinese, Japanese, Thai, South Asian and Arabic serials). Local
// catalogue entries may store the language name instead of the code.
const _dramaLanguages = {
  'ko',
  'ja',
  'zh',
  'cn',
  'th',
  'tr',
  'hi',
  'ur',
  'bn',
  'ta',
  'te',
  'ml',
  'mr',
  'pa',
  'ar',
  'fa',
  'tl',
  'id',
  'ms',
  'vi',
  'korean',
  'japanese',
  'chinese',
  'mandarin',
  'cantonese',
  'thai',
  'turkish',
  'hindi',
  'urdu',
  'bangla',
  'bengali',
  'tamil',
  'telugu',
  'malayalam',
  'arabic',
  'filipino',
  'indonesian',
};

/// Which Discover group an item belongs to. Exported for tests.
String discoverSection(CatalogItem item) {
  switch (item.section) {
    case 'sports':
      return 'Sports';
    case 'movies':
      return 'Movies';
    case 'series':
      return 'Web Series';
    case 'dramas':
      return 'Dramas';
  }
  switch (item.type) {
    case 'channel':
      return item.category.toLowerCase().contains('sport')
          ? 'Sports'
          : 'Live Channels';
    case 'video':
    case 'short':
      // Untagged videos come from the official sports channels.
      return 'Sports';
    case 'movie':
      return 'Movies';
    default:
      final language = item.language.trim().toLowerCase();
      final drama = _dramaLanguages.contains(language) ||
          item.genres.any((genre) => genre.toLowerCase() == 'soap');
      return drama ? 'Dramas' : 'Web Series';
  }
}

/// Search across channels, movies and series, plus genre shortcuts.
class DiscoverPage extends StatefulWidget {
  const DiscoverPage({super.key});
  @override
  State<DiscoverPage> createState() => _DiscoverPageState();
}

class _DiscoverPageState extends State<DiscoverPage> {
  final _controller = TextEditingController();
  Timer? _debounce;
  String _section = 'All';

  @override
  void initState() {
    super.initState();
    context.read<CatalogCubit>().loadTrending();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400),
        () => context.read<CatalogCubit>().search(value));
  }

  void _clear() {
    _controller.clear();
    _onChanged('');
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final searching = _controller.text.trim().isNotEmpty;
    final List<CatalogItem> rows =
        searching ? state.searchResults : state.trending;
    final groups = {
      for (final section in discoverSections)
        section: [
          for (final item in rows)
            if (discoverSection(item) == section) item
        ]
    }..removeWhere((_, items) => items.isEmpty);
    // A category with no results falls back to everything.
    final section = groups.containsKey(_section) ? _section : 'All';
    String chip(String name) => '$name ${groups[name]!.length}';
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: kPageGradient),
      child: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PageTitle('Discover'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: TextField(
              controller: _controller,
              onChanged: _onChanged,
              textInputAction: TextInputAction.search,
              style: const TextStyle(fontSize: 17),
              decoration: InputDecoration(
                hintText: 'Search',
                hintStyle: const TextStyle(color: kMuted),
                filled: true,
                fillColor: const Color(0x33000000),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                suffixIcon: searching
                    ? IconButton(
                        tooltip: 'Clear search',
                        onPressed: _clear,
                        icon: const Icon(Icons.close))
                    : const Icon(Icons.search, color: Colors.white70),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: Color(0x44FFFFFF))),
                focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: kPink)),
              ),
            ),
          ),
          const SizedBox(height: 14),
          if (searching && groups.length > 1)
            FilterChips(
                labels: ['All', for (final name in groups.keys) chip(name)],
                selected: section == 'All' ? 'All' : chip(section),
                onSelected: (label) => setState(() => _section = groups.keys
                    .firstWhere((name) => chip(name) == label,
                        orElse: () => 'All')))
          else
            FilterChips(
                labels: _genres,
                onSelected: (genre) => context.push('/browse',
                    extra: BrowseTarget(
                        kind: 'movies', title: genre, genre: genre))),
          const SizedBox(height: 14),
          const Divider(height: 1, color: Color(0x1FFFFFFF)),
          Expanded(
              child: searching && state.searching && rows.isEmpty
                  ? const Center(child: CircularProgressIndicator(color: kPink))
                  : rows.isEmpty
                      ? EmptyState(
                          icon: Icons.search,
                          title: searching ? 'No matches' : 'Find something',
                          body: searching
                              ? 'Try a different title or channel name.'
                              : 'Search live channels, sports, movies, web series and dramas.')
                      : ListView(
                          padding: const EdgeInsets.only(top: 8, bottom: 24),
                          keyboardDismissBehavior:
                              ScrollViewKeyboardDismissBehavior.onDrag,
                          children: [
                              for (final entry in groups.entries)
                                if (section == 'All' ||
                                    entry.key == section) ...[
                                  _GroupHeader(
                                      title: searching
                                          ? entry.key
                                          : 'Trending ${entry.key}',
                                      count: entry.value.length,
                                      onSeeAll: section == 'All' &&
                                              searching &&
                                              entry.value.length > _preview
                                          ? () => setState(
                                              () => _section = entry.key)
                                          : null),
                                  for (final item
                                      in section == 'All' && searching
                                          ? entry.value.take(_preview)
                                          : entry.value)
                                    MediaRow(item: item),
                                ],
                            ])),
        ]),
      ),
    );
  }
}

/// Rows shown per group under "All"; "See all" opens the whole group.
const _preview = 5;

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.title, required this.count, this.onSeeAll});
  final String title;
  final int count;
  final VoidCallback? onSeeAll;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 8, 6),
        child: Row(children: [
          Expanded(
              child: Text.rich(TextSpan(children: [
            TextSpan(
                text: title,
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            TextSpan(
                text: '  $count',
                style: const TextStyle(fontSize: 15, color: kMuted)),
          ]))),
          if (onSeeAll != null)
            TextButton(onPressed: onSeeAll, child: const Text('See all')),
        ]),
      );
}
