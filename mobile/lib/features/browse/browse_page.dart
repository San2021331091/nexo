import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../live/live_page.dart';
import '../shared/widgets.dart';

/// The "View All" grid for a home section: channels, or paged movies/series.
class BrowsePage extends StatefulWidget {
  const BrowsePage({super.key, required this.target});
  final BrowseTarget target;
  @override
  State<BrowsePage> createState() => _BrowsePageState();
}

class _BrowsePageState extends State<BrowsePage> {
  final _controller = ScrollController();
  final _items = <CatalogItem>[];
  final _seen = <String>{};
  int _page = 0;
  bool _loading = false;
  bool _hasMore = true;
  bool _failed = false;

  bool get _isChannels => widget.target.kind == 'channels';

  @override
  void initState() {
    super.initState();
    if (!_isChannels) {
      _controller.addListener(() {
        if (_controller.position.extentAfter < 600) _loadMore();
      });
      _loadMore();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    final repository = context.read<CatalogCubit>().repository;
    final target = widget.target;
    try {
      final next = target.kind == 'series'
          ? await repository.series(
              genre: target.genre,
              language: target.language,
              list: target.list,
              page: _page + 1)
          : await repository.movies(
              genre: target.genre,
              language: target.language,
              list: target.list,
              page: _page + 1);
      if (!mounted) return;
      setState(() {
        _page++;
        _items.addAll(next.where((item) => _seen.add(item.id)));
        // Stop at an empty page, and cap how deep one grid can go.
        _hasMore = next.isNotEmpty && _page < 25;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  Widget _channels(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final category = widget.target.category;
    final channels = category.isEmpty
        ? state.channels
        : state.channels
            .where((channel) =>
                channel.category.toLowerCase() == category.toLowerCase())
            .toList();
    if (state.loading && channels.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: kPink));
    }
    if (channels.isEmpty) {
      return const EmptyState(
          icon: Icons.live_tv,
          title: 'No channels available',
          body: 'Channels in this category will appear here.');
    }
    return ChannelGrid(channels: channels);
  }

  Widget _titles() {
    if (_items.isEmpty) {
      if (_loading) {
        return const Center(child: CircularProgressIndicator(color: kPink));
      }
      return EmptyState(
          icon: Icons.movie_outlined,
          title: _failed ? 'Could not load' : 'Nothing to Show',
          body: _failed
              ? 'Check your connection and try again.'
              : 'Titles will appear here when available.',
          action: _failed
              ? TextButton(onPressed: _loadMore, child: const Text('Retry'))
              : null);
    }
    return LayoutBuilder(builder: (context, constraints) {
      final columns = (constraints.maxWidth / 130).floor().clamp(3, 8);
      return GridView.builder(
        controller: _controller,
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 2 / 3),
        itemCount: _items.length,
        itemBuilder: (context, index) => PosterCard(item: _items[index]),
      );
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.target.title)),
        body: _isChannels ? _channels(context) : _titles(),
      );
}
