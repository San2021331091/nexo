import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../discover/discover_page.dart';
import '../shared/widgets.dart';

/// The Home tab ids and the Discover group each one searches in.
const sectionForTab = {
  'live': 'Live Channels',
  'sports': 'Sports',
  'movies': 'Movies',
  'series': 'Web Series',
  'dramas': 'Dramas',
};

const _hints = {
  'Live Channels': 'Search live TV channels',
  'Sports': 'Search sports, teams, leagues, channels',
  'Movies': 'Search movies',
  'Web Series': 'Search web series',
  'Dramas': 'Search dramas',
};

const _icons = {
  'Live Channels': Icons.live_tv,
  'Sports': Icons.sports_soccer,
  'Movies': Icons.movie_outlined,
  'Web Series': Icons.tv,
  'Dramas': Icons.theater_comedy_outlined,
};

/// Search limited to one section (Sports, Movies, Web Series, Dramas, Live
/// Channels), or everything when [section] is null.
class SectionSearchPage extends StatefulWidget {
  const SectionSearchPage({super.key, this.section});

  /// One of [discoverSections], or null for all of them.
  final String? section;
  @override
  State<SectionSearchPage> createState() => _SectionSearchPageState();
}

class _SectionSearchPageState extends State<SectionSearchPage> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<CatalogItem> _results = const [];
  bool _loading = false;
  bool _failed = false;
  int _request = 0;

  String? get _section =>
      discoverSections.contains(widget.section) ? widget.section : null;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _changed(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce =
        Timer(const Duration(milliseconds: 400), () => _search(value.trim()));
  }

  Future<void> _search(String query) async {
    final request = ++_request;
    if (query.isEmpty) {
      setState(() {
        _results = const [];
        _loading = false;
        _failed = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final items = await context.read<CatalogCubit>().repository.search(query);
      if (!mounted || request != _request) return;
      final section = _section;
      setState(() {
        _results = section == null
            ? items
            : items.where((item) => discoverSection(item) == section).toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted || request != _request) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  void _clear() {
    _controller.clear();
    _changed('');
  }

  @override
  Widget build(BuildContext context) {
    final section = _section;
    final query = _controller.text.trim();
    return Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: kBg,
        scrolledUnderElevation: 0,
        titleSpacing: 0,
        title: TextField(
          controller: _controller,
          autofocus: true,
          onChanged: _changed,
          onSubmitted: (value) {
            _debounce?.cancel();
            _search(value.trim());
          },
          textInputAction: TextInputAction.search,
          style: const TextStyle(fontSize: 17),
          decoration: InputDecoration(
            hintText: _hints[section] ?? 'Search channels, sports, movies…',
            hintStyle: const TextStyle(color: kMuted),
            border: InputBorder.none,
            suffixIcon: query.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    onPressed: _clear,
                    icon: const Icon(Icons.close)),
          ),
        ),
      ),
      body: query.isEmpty
          ? EmptyState(
              icon: _icons[section] ?? Icons.search,
              title: section == null ? 'Search NEXO' : 'Search $section',
              body: section == 'Sports'
                  ? 'Try a team, league, sport or channel, like "cricket" or "Premier League".'
                  : 'Type a title, channel or keyword.')
          : _loading && _results.isEmpty
              ? const Center(child: CircularProgressIndicator(color: kPink))
              : _failed
                  ? Align(
                      alignment: Alignment.topCenter,
                      child: ErrorNotice(
                          message: 'Search could not be loaded right now.',
                          retry: () => _search(query)))
                  : _results.isEmpty
                      ? EmptyState(
                          icon: Icons.search_off,
                          title: 'No matches',
                          body: section == null
                              ? 'Try a different word.'
                              : 'Nothing in $section matches "$query".')
                      : ListView.builder(
                          padding: EdgeInsets.only(
                              top: 4,
                              bottom:
                                  MediaQuery.paddingOf(context).bottom + 24),
                          keyboardDismissBehavior:
                              ScrollViewKeyboardDismissBehavior.onDrag,
                          itemCount: _results.length + 1,
                          itemBuilder: (context, index) => index == 0
                              ? Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(20, 12, 20, 6),
                                  child: Text(
                                      '${_results.length} result${_results.length == 1 ? '' : 's'}${section == null ? '' : ' in $section'}',
                                      style: const TextStyle(
                                          color: kMuted,
                                          fontWeight: FontWeight.w600)))
                              : MediaRow(item: _results[index - 1])),
    );
  }
}
