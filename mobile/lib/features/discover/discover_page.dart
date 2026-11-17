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

/// Search across channels, movies and series, plus genre shortcuts.
class DiscoverPage extends StatefulWidget {
  const DiscoverPage({super.key});
  @override
  State<DiscoverPage> createState() => _DiscoverPageState();
}

class _DiscoverPageState extends State<DiscoverPage> {
  final _controller = TextEditingController();
  Timer? _debounce;

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
                              : 'Search live channels, movies and series.')
                      : ListView.builder(
                          padding: const EdgeInsets.only(top: 8, bottom: 24),
                          keyboardDismissBehavior:
                              ScrollViewKeyboardDismissBehavior.onDrag,
                          itemCount: rows.length + 1,
                          itemBuilder: (context, index) => index == 0
                              ? Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(20, 14, 20, 8),
                                  child: Text(
                                      searching
                                          ? 'Results'
                                          : 'Trending Series & Movies',
                                      style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.w700)))
                              : MediaRow(item: rows[index - 1]))),
        ]),
      ),
    );
  }
}
