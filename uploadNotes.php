<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("topic.php");
require_once("notes.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
// $topics = Topic::find_all();

$theTopicId = $_POST['theTopicId'];

if(isset($_POST['submit'])){
	$tid = mysql_real_escape_string(htmlspecialchars($_POST['topic_id']));
	$note = mysql_real_escape_string(htmlspecialchars($_POST['note']));
	$title = mysql_real_escape_string(htmlspecialchars($_POST['title']));
	$beginTime = mysql_real_escape_string(htmlspecialchars($_POST['begin_time']));
	$endTime = mysql_real_escape_string(htmlspecialchars($_POST['end_time']));

	$newNote = Note::newNote($tid, $note, $title, $beginTime, $endTime);

	if($newNote->save()){
		redirect_to("settings.php");
	} else {
		die("Cannot create note." . mysql_error());
	}	
}

?>

	<div id="registerErrorMessages"></div>
		<form id="uploadNotesForm" action="uploadNotes.php" method="post">
			<fieldset>
				<legend class="formTitle">Annotations:</legend>
				<label for="title">Title:</label>
				<input class="text" id="title" name="title"/>
				<label for="note">Note:</label>
				<textarea class="text" row="5" cols="40" id="note" name="note"/>
				<label for="begin_time">Begin Time:</label>
				<div class="input-append bootstrap-timepicker">
					<input id="begin_time" name="begin_time" type="text" class="input-small">
					<span class="add-on"><i class="icon-time"></i></span>
				</div>
				<script type="text/javascript">
					$('#begin_time').timepicker({
						defaultTime:false,
						minuteStep: 1,
						showSeconds: true,
						showMeridian: false
					});
				</script>
				<label for="end_time">End Time:</label>
				<div class="input-append bootstrap-timepicker">
					<input id="end_time" name="end_time" type="text" class="input-small">
					<span class="add-on"><i class="icon-time"></i></span>
				</div>
				<script type="text/javascript">
					$('#end_time').timepicker({
						defaultTime:false,
						minuteStep: 1,
						showSeconds: true,
						showMeridian: false
					});
				</script>
				<input type="hidden" id="topic_id" name="topic_id" value="<?=$theTopicId?>"/>
				<input type="hidden" id="submit2" name="submit"/>
				<input id="noteSubmit" type="submit" name="submit" value="submit"/>
			</fieldset>
		</form>

<script>
	$('#annotationBlock').unbind();
	$('#annotationBlock').on("click","#noteSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('19');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="uploadNotesForm"] #title').val();
		var note = $('form[id="uploadNotesForm"] #note').val();
		var begin = $('form[id="uploadNotesForm"] #begin_time').val();
		var end = $('form[id="uploadNotesForm"] #end_time').val();

		if(title == ''){
			valid += '<p> Title is required. </p>';
		}

		if(note == ''){
			valid += '<p> A note is required. </p>';
		}

		if(begin == ''){
			valid += '<p> Begin time is required. </p>';
		}

		if(end == ''){
			valid += '<p> End time is required. </p>';
		}

		if(begin >= end){
			valid += '<p> Please enter a proper time value. </p>';
		}
		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			noteFormData = $('form[id="uploadNotesForm"]').serialize();
			submitNoteData(noteFormData);
		}
	});



	function submitNoteData(formData){
		$.ajax({
			type:'POST',
			url: 'uploadNotes.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Note added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#notesListingBlock").load("noteListing.php",{ 'theTopicId': <?=$theTopicId?> });

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The note could not be added.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadNotesForm"]')[0].reset();
			}
		});
	};

</script>