

 	<div class="row-fluid">
		<div class="span4">
			<div id="addEditNotesBlock">
			</div>
		</div>
		<div class="span8">
			<div id="notesListingBlock">
			</div>
		</div>
	</div>
	<script>
		$("#addEditNotesBlock").load('uploadNotes.php');
		$("#notesListingBlock").load('noteListing.php');
	</script>